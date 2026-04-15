import type { PowerMemAddResult, PowerMemSearchResult } from "./client.js";
import type { LocalEmbeddingFactory } from "./local-embedding.js";
import { LocalSqliteStore } from "./local-sqlite.js";

export type RemoteClient = {
  health: () => Promise<{ status: string; error?: string }>;
  add: (
    content: string,
    options?: { infer?: boolean; metadata?: Record<string, unknown> },
  ) => Promise<PowerMemAddResult[]>;
  search: (query: string, limit?: number) => Promise<PowerMemSearchResult[]>;
  delete: (memoryId: number | string) => Promise<void>;
  agentMemoryAdd?: (
    targetAgentId: string,
    content: string,
  ) => Promise<PowerMemAddResult | null>;
  agentMemoryList?: (
    targetAgentId: string,
    limit?: number,
    offset?: number,
  ) => Promise<Array<Record<string, unknown>>>;
  agentMemoryShare?: (
    fromAgentId: string,
    targetAgentId: string,
    memoryIds?: number[],
  ) => Promise<{ shared_count?: number }>;
  agentMemoryShared?: (
    targetAgentId: string,
    limit?: number,
    offset?: number,
  ) => Promise<Array<Record<string, unknown>>>;
};

type Logger = { info?: (msg: string) => void; warn?: (msg: string) => void };

export type DualWriteOptions = {
  localUserId: string;
  localAgentId: string;
  syncOnResume: boolean;
  syncBatchSize: number;
  syncMinIntervalMs: number;
  syncBaseDelayMs: number;
  syncMaxDelayMs: number;
  syncMaxRetries: number;
  embedding?: LocalEmbeddingFactory | null;
  logger?: Logger;
};

export class DualWriteClient {
  private remote: RemoteClient;
  private local: LocalSqliteStore;
  private localUserId: string;
  private localAgentId: string;
  private syncOnResume: boolean;
  private syncBatchSize: number;
  private syncMinIntervalMs: number;
  private syncBaseDelayMs: number;
  private syncMaxDelayMs: number;
  private syncMaxRetries: number;
  private embedding?: LocalEmbeddingFactory | null;
  private logger?: Logger;
  private pendingSyncInFlight = false;
  private lastSyncAt = 0;

  constructor(remote: RemoteClient, local: LocalSqliteStore, options: DualWriteOptions) {
    this.remote = remote;
    this.local = local;
    this.localUserId = options.localUserId;
    this.localAgentId = options.localAgentId;
    this.syncOnResume = options.syncOnResume;
    this.syncBatchSize = options.syncBatchSize;
    this.syncMinIntervalMs = options.syncMinIntervalMs;
    this.syncBaseDelayMs = options.syncBaseDelayMs;
    this.syncMaxDelayMs = options.syncMaxDelayMs;
    this.syncMaxRetries = options.syncMaxRetries;
    this.embedding = options.embedding ?? null;
    this.logger = options.logger;
  }

  private async upsertEmbedding(localId: number, content: string): Promise<void> {
    if (!this.embedding) return;
    const provider = await this.embedding.get();
    if (!provider) return;
    try {
      const embedding = await provider.embed(content);
      if (embedding.length === 0) return;
      this.local.upsertEmbedding(localId, embedding);
    } catch (err) {
      this.logger?.warn?.(`dual-write: local embedding failed: ${String(err)}`);
    }
  }

  async health(): Promise<{ status: string; error?: string }> {
    return this.remote.health();
  }

  async add(
    content: string,
    options: { infer?: boolean; metadata?: Record<string, unknown> } = {},
  ): Promise<PowerMemAddResult[]> {
    try {
      const created = await this.remote.add(content, options);
      if (created.length > 0) {
        for (const row of created) {
          const remoteId = String(row.memory_id ?? "");
          if (remoteId) {
            const localId = this.local.upsertRemoteMemory({
              remoteId,
              content: row.content,
              metadata: row.metadata ?? options.metadata,
              userId: this.localUserId,
              agentId: this.localAgentId,
            });
            await this.upsertEmbedding(localId, row.content);
          }
        }
      }
      void this.syncPending("remote-add-success");
      return created;
    } catch (err) {
      const localId = this.local.addLocalMemory({
        content,
        metadata: options.metadata,
        userId: this.localUserId,
        agentId: this.localAgentId,
      });
      await this.upsertEmbedding(localId, content);
      this.local.enqueuePending({
        localMemoryId: localId,
        content,
        metadata: options.metadata,
        userId: this.localUserId,
        agentId: this.localAgentId,
        infer: options.infer ?? true,
      });
      this.logger?.warn?.(
        `dual-write: remote add failed, stored locally (id=${localId}): ${String(err)}`,
      );
      return [
        {
          memory_id: String(localId),
          content,
          user_id: this.localUserId,
          agent_id: this.localAgentId,
          metadata: options.metadata,
        },
      ];
    }
  }

  async search(query: string, limit = 5): Promise<PowerMemSearchResult[]> {
    try {
      const results = await this.remote.search(query, limit);
      if (results.length > 0) {
        for (const row of results) {
          const remoteId = String(row.memory_id ?? "");
          if (!remoteId) continue;
          const localId = this.local.upsertRemoteMemory({
            remoteId,
            content: row.content,
            metadata: row.metadata,
            userId: this.localUserId,
            agentId: this.localAgentId,
          });
          await this.upsertEmbedding(localId, row.content);
        }
      }
      void this.syncPending("remote-search-success");
      return results;
    } catch (err) {
      this.logger?.warn?.(`dual-write: remote search failed, fallback to local: ${String(err)}`);
      const provider = await this.embedding?.get();
      if (provider) {
        try {
          const embedding = await provider.embed(query);
          const vectorRows = this.local.searchVector({
            embedding,
            limit,
            userId: this.localUserId,
            agentId: this.localAgentId,
          });
          if (vectorRows.length > 0) {
            return vectorRows.map((row) => ({
              memory_id: row.remote_id ?? String(row.id),
              content: row.content,
              score: row.score,
              metadata: row.metadata,
            }));
          }
        } catch (embedErr) {
          this.logger?.warn?.(`dual-write: local vector search failed: ${String(embedErr)}`);
        }
      }
      const rows = this.local.search({
        query,
        limit,
        userId: this.localUserId,
        agentId: this.localAgentId,
      });
      return rows.map((row) => ({
        memory_id: row.remote_id ?? String(row.id),
        content: row.content,
        score: row.score,
        metadata: row.metadata,
      }));
    }
  }

  async delete(memoryId: number | string): Promise<void> {
    const id = typeof memoryId === "string" ? memoryId : String(memoryId);
    try {
      await this.remote.delete(memoryId);
      this.local.deleteByRemoteId(id);
      return;
    } catch (err) {
      this.logger?.warn?.(`dual-write: remote delete failed, try local: ${String(err)}`);
      const localId = Number(id);
      if (Number.isFinite(localId)) {
        this.local.deleteByLocalId(localId);
      } else {
        this.local.deleteByRemoteId(id);
      }
    }
  }

  async agentMemoryAdd(
    targetAgentId: string,
    content: string,
  ): Promise<PowerMemAddResult | null> {
    if (!this.remote.agentMemoryAdd) {
      throw new Error("agent memory APIs require http v2 backend");
    }
    return this.remote.agentMemoryAdd(targetAgentId, content);
  }

  async agentMemoryList(
    targetAgentId: string,
    limit = 20,
    offset = 0,
  ): Promise<Array<Record<string, unknown>>> {
    if (!this.remote.agentMemoryList) {
      throw new Error("agent memory APIs require http v2 backend");
    }
    return this.remote.agentMemoryList(targetAgentId, limit, offset);
  }

  async agentMemoryShare(
    fromAgentId: string,
    targetAgentId: string,
    memoryIds?: number[],
  ): Promise<{ shared_count?: number }> {
    if (!this.remote.agentMemoryShare) {
      throw new Error("agent memory APIs require http v2 backend");
    }
    return this.remote.agentMemoryShare(fromAgentId, targetAgentId, memoryIds);
  }

  async agentMemoryShared(
    targetAgentId: string,
    limit = 20,
    offset = 0,
  ): Promise<Array<Record<string, unknown>>> {
    if (!this.remote.agentMemoryShared) {
      throw new Error("agent memory APIs require http v2 backend");
    }
    return this.remote.agentMemoryShared(targetAgentId, limit, offset);
  }

  async syncPending(trigger: string): Promise<void> {
    if (!this.syncOnResume) return;
    const now = Date.now();
    if (now - this.lastSyncAt < this.syncMinIntervalMs) return;
    if (this.pendingSyncInFlight) return;
    const pending = this.local.listPending(this.syncBatchSize, true);
    if (pending.length === 0) return;
    this.lastSyncAt = now;
    this.pendingSyncInFlight = true;
    this.logger?.info?.(`dual-write: ${trigger}, syncing ${pending.length} pending writes`);
    const synced: number[] = [];
    try {
      for (const row of pending) {
        if (this.syncMaxRetries > 0 && row.retries >= this.syncMaxRetries) {
          this.logger?.warn?.(`dual-write: skip pending id=${row.id}, retries=${row.retries}`);
          continue;
        }
        try {
          const created = await this.remote.add(row.content, {
            infer: row.infer,
            metadata: row.metadata,
          });
          if (created.length === 1 && row.local_memory_id) {
            const remoteId = String(created[0].memory_id ?? "");
            if (remoteId) {
              this.local.updateRemoteId(row.local_memory_id, remoteId);
            }
          }
          synced.push(row.id);
        } catch {
          const delay = Math.min(
            this.syncMaxDelayMs,
            this.syncBaseDelayMs * Math.pow(2, row.retries),
          );
          const nextRetryAt = new Date(Date.now() + delay).toISOString();
          this.local.scheduleRetries([row.id], nextRetryAt);
          break;
        }
      }
      if (synced.length > 0) {
        this.local.removePending(synced);
      }
    } finally {
      this.pendingSyncInFlight = false;
    }
  }
}
