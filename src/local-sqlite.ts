/**
 * Local sqlite store for dual-write mode.
 * Provides lightweight storage + pending queue for remote sync.
 */

import Database from "better-sqlite3";
import sqliteVec from "sqlite-vec";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type LocalMemoryRow = {
  id: number;
  remote_id: string | null;
  content: string;
  metadata: Record<string, unknown>;
  user_id: string | null;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PendingRow = {
  id: number;
  local_memory_id: number | null;
  content: string;
  metadata: Record<string, unknown>;
  user_id: string | null;
  agent_id: string | null;
  infer: boolean;
  queued_at: string;
  retries: number;
  last_error: string | null;
};

export type LocalVectorConfig = {
  enabled: boolean;
  extensionPath?: string;
};

type Logger = { info?: (msg: string) => void; warn?: (msg: string) => void };

function nowIso(): string {
  return new Date().toISOString();
}

function safeJsonParse(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const parts = text.toLowerCase().split(/[\s,.;:!?。，；：！？、]+/);
  for (const part of parts) {
    if (!part) continue;
    const subTokens = part.match(/[\u4e00-\u9fff\u3400-\u4dbf]|[a-z0-9_-]+/g);
    if (subTokens) tokens.push(...subTokens);
  }
  return tokens;
}

function tokenOverlap(queryTokens: string[], contentTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const contentSet = new Set(contentTokens);
  let hits = 0;
  for (const t of queryTokens) {
    if (contentSet.has(t)) hits++;
  }
  return hits / queryTokens.length;
}

const VECTOR_TABLE = "memories_vec";
const META_TABLE = "meta";
const VECTOR_DIMS_KEY = "vector_dims";

function vectorToBlob(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

export class LocalSqliteStore {
  private db: Database.Database;
  private logger?: Logger;
  private ftsEnabled = false;
  private hasNextRetryAt = true;
  private hasLastError = true;
  private vector = {
    enabled: false,
    available: false,
    dims: undefined as number | undefined,
    extensionPath: undefined as string | undefined,
    loadError: undefined as string | undefined,
  };

  constructor(dbPath: string, options?: { logger?: Logger; vector?: LocalVectorConfig }) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.logger = options?.logger;
    this.vector.enabled = options?.vector?.enabled ?? false;
    this.vector.extensionPath = options?.vector?.extensionPath;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${META_TABLE} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        remote_id TEXT,
        content TEXT NOT NULL,
        metadata TEXT,
        user_id TEXT,
        agent_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_writes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_memory_id INTEGER,
        content TEXT NOT NULL,
        metadata TEXT,
        user_id TEXT,
        agent_id TEXT,
        infer INTEGER DEFAULT 1,
        queued_at TEXT NOT NULL,
        retries INTEGER DEFAULT 0,
        next_retry_at TEXT,
        last_error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_memories_user_agent
        ON memories(user_id, agent_id);

      CREATE INDEX IF NOT EXISTS idx_memories_remote_id
        ON memories(remote_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_remote_unique
        ON memories(remote_id)
        WHERE remote_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_pending_created
        ON pending_writes(queued_at);
    `);

    this.vector.dims = this.readVectorDims();
    if (this.vector.enabled) {
      this.loadVectorExtension();
    }

    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          content,
          user_id,
          agent_id,
          content='memories',
          content_rowid='id'
        );
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, content, user_id, agent_id)
          VALUES (new.id, new.content, new.user_id, new.agent_id);
        END;

        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content, user_id, agent_id)
          VALUES ('delete', old.id, old.content, old.user_id, old.agent_id);
        END;

        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content, user_id, agent_id)
          VALUES ('delete', old.id, old.content, old.user_id, old.agent_id);
          INSERT INTO memories_fts(rowid, content, user_id, agent_id)
          VALUES (new.id, new.content, new.user_id, new.agent_id);
        END;
      `);
      this.ftsEnabled = true;
    } catch (err) {
      this.logger?.warn?.(`local-sqlite: fts5 disabled: ${String(err)}`);
      this.ftsEnabled = false;
    }

    try {
      this.db.exec(`ALTER TABLE pending_writes ADD COLUMN next_retry_at TEXT`);
      this.hasNextRetryAt = true;
    } catch (err) {
      const msg = String(err ?? "");
      if (msg.includes("duplicate column name") || msg.includes("duplicate column")) {
        this.hasNextRetryAt = true;
      } else {
        this.hasNextRetryAt = false;
      }
    }
    try {
      this.db.exec(`ALTER TABLE pending_writes ADD COLUMN last_error TEXT`);
      this.hasLastError = true;
    } catch (err) {
      const msg = String(err ?? "");
      if (msg.includes("duplicate column name") || msg.includes("duplicate column")) {
        this.hasLastError = true;
      } else {
        this.hasLastError = false;
      }
    }
  }

  private readVectorDims(): number | undefined {
    try {
      const row = this.db
        .prepare(`SELECT value FROM ${META_TABLE} WHERE key = ?`)
        .get(VECTOR_DIMS_KEY) as { value?: string } | undefined;
      const raw = row?.value;
      if (!raw) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.floor(n) : undefined;
    } catch {
      return undefined;
    }
  }

  private writeVectorDims(value?: number): void {
    try {
      if (!value) {
        this.db.prepare(`DELETE FROM ${META_TABLE} WHERE key = ?`).run(VECTOR_DIMS_KEY);
        return;
      }
      this.db
        .prepare(
          `INSERT INTO ${META_TABLE} (key, value) VALUES (?, ?)\n` +
            `ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(VECTOR_DIMS_KEY, String(value));
    } catch (err) {
      this.logger?.warn?.(`local-sqlite: failed to persist vector dims: ${String(err)}`);
    }
  }

  private loadVectorExtension(): void {
    try {
      if (this.vector.extensionPath) {
        this.db.loadExtension(this.vector.extensionPath);
      } else {
        sqliteVec.load(this.db);
      }
      this.vector.available = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.vector.available = false;
      this.vector.loadError = message;
      this.logger?.warn?.(`local-sqlite: sqlite-vec unavailable: ${message}`);
    }
  }

  private ensureVectorTable(dimensions: number): boolean {
    if (!this.vector.enabled || !this.vector.available) {
      return false;
    }
    if (this.vector.dims === dimensions && !this.vectorTableNeedsRebuild()) {
      return true;
    }
    if (this.vector.dims && this.vector.dims !== dimensions) {
      this.dropVectorTable();
    } else if (this.vectorTableNeedsRebuild()) {
      this.dropVectorTable();
    }
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${VECTOR_TABLE} USING vec0(\n` +
        `  embedding FLOAT[${dimensions}]\n` +
        `)`,
    );
    this.vector.dims = dimensions;
    this.writeVectorDims(dimensions);
    return true;
  }

  private dropVectorTable(): void {
    try {
      this.db.exec(`DROP TABLE IF EXISTS ${VECTOR_TABLE}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn?.(`local-sqlite: failed to drop ${VECTOR_TABLE}: ${message}`);
    }
    this.vector.dims = undefined;
    this.writeVectorDims(undefined);
  }

  private vectorTableNeedsRebuild(): boolean {
    try {
      const cols = this.db
        .prepare(`PRAGMA table_info(${VECTOR_TABLE})`)
        .all() as Array<{ name?: string }>;
      if (!cols || cols.length === 0) {
        return false;
      }
      return cols.some((col) => col?.name === "id");
    } catch {
      return false;
    }
  }

  upsertRemoteMemory(params: {
    remoteId: string;
    content: string;
    metadata?: Record<string, unknown>;
    userId?: string;
    agentId?: string;
  }): number {
    const now = nowIso();
    const existing = this.db
      .prepare(`SELECT id FROM memories WHERE remote_id = ?`)
      .get(params.remoteId) as { id: number } | undefined;
    if (existing?.id) {
      const stmt = this.db.prepare(`
        UPDATE memories
        SET content = @content,
            metadata = @metadata,
            user_id = @user_id,
            agent_id = @agent_id,
            updated_at = @updated_at
        WHERE id = @id
      `);
      stmt.run({
        id: existing.id,
        content: params.content,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        user_id: params.userId ?? null,
        agent_id: params.agentId ?? null,
        updated_at: now,
      });
      return existing.id;
    }

    const stmt = this.db.prepare(`
      INSERT INTO memories (remote_id, content, metadata, user_id, agent_id, created_at, updated_at)
      VALUES (@remote_id, @content, @metadata, @user_id, @agent_id, @created_at, @updated_at)
    `);
    const info = stmt.run({
      remote_id: params.remoteId,
      content: params.content,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      user_id: params.userId ?? null,
      agent_id: params.agentId ?? null,
      created_at: now,
      updated_at: now,
    });
    return Number(info.lastInsertRowid ?? 0);
  }

  addLocalMemory(params: {
    content: string;
    metadata?: Record<string, unknown>;
    userId?: string;
    agentId?: string;
  }): number {
    const now = nowIso();
    const stmt = this.db.prepare(`
      INSERT INTO memories (remote_id, content, metadata, user_id, agent_id, created_at, updated_at)
      VALUES (NULL, @content, @metadata, @user_id, @agent_id, @created_at, @updated_at)
    `);
    const info = stmt.run({
      content: params.content,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      user_id: params.userId ?? null,
      agent_id: params.agentId ?? null,
      created_at: now,
      updated_at: now,
    });
    return Number(info.lastInsertRowid ?? 0);
  }

  upsertEmbedding(localId: number, embedding: number[]): boolean {
    if (!this.ensureVectorTable(embedding.length)) {
      return false;
    }
    const rowid =
      typeof localId === "bigint"
        ? localId
        : Number.isSafeInteger(localId) && localId > 0
          ? BigInt(localId)
          : null;
    if (!rowid) {
      this.logger?.warn?.(
        `local-sqlite: skip vector write (invalid rowid=${String(localId)})`,
      );
      return false;
    }
    const writeOnce = () => {
      this.db.prepare(`DELETE FROM ${VECTOR_TABLE} WHERE rowid = ?`).run(rowid);
      this.db
        .prepare(`INSERT INTO ${VECTOR_TABLE} (rowid, embedding) VALUES (?, ?)`)
        .run(rowid, vectorToBlob(embedding));
    };
    try {
      writeOnce();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("primary key") || message.includes("memories_vec")) {
        this.dropVectorTable();
        if (!this.ensureVectorTable(embedding.length)) {
          return false;
        }
        try {
          writeOnce();
          return true;
        } catch (retryErr) {
          const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
          this.logger?.warn?.(`local-sqlite: vector write failed: ${retryMessage}`);
          return false;
        }
      }
      this.logger?.warn?.(`local-sqlite: vector write failed: ${message}`);
      return false;
    }
  }

  updateRemoteId(localId: number, remoteId: string): void {
    const stmt = this.db.prepare(`
      UPDATE memories SET remote_id = @remote_id, updated_at = @updated_at
      WHERE id = @id
    `);
    stmt.run({ id: localId, remote_id: remoteId, updated_at: nowIso() });
  }

  deleteByRemoteId(remoteId: string): void {
    const row = this.db
      .prepare(`SELECT id FROM memories WHERE remote_id = ?`)
      .get(remoteId) as { id: number } | undefined;
    if (row?.id) {
      this.deleteByLocalId(row.id);
      return;
    }
    const stmt = this.db.prepare(`DELETE FROM memories WHERE remote_id = ?`);
    stmt.run(remoteId);
  }

  deleteByLocalId(localId: number): void {
    const stmt = this.db.prepare(`DELETE FROM memories WHERE id = ?`);
    stmt.run(localId);
    if (this.vector.enabled && this.vector.available) {
      const rowid =
        typeof localId === "bigint"
          ? localId
          : Number.isSafeInteger(localId) && localId > 0
            ? BigInt(localId)
            : null;
      if (rowid) {
        this.db.prepare(`DELETE FROM ${VECTOR_TABLE} WHERE rowid = ?`).run(rowid);
      }
    }
  }

  search(params: {
    query: string;
    limit: number;
    userId?: string;
    agentId?: string;
  }): Array<LocalMemoryRow & { score: number }> {
    const tokens = tokenize(params.query);
    if (tokens.length === 0) return [];

    if (this.ftsEnabled) {
      const clauses: string[] = [];
      const values: Array<string | number | null> = [];
      if (params.userId) {
        clauses.push("memories.user_id = ?");
        values.push(params.userId);
      }
      if (params.agentId) {
        clauses.push("memories.agent_id = ?");
        values.push(params.agentId);
      }
      const where = clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "";
      try {
        const stmt = this.db.prepare(`
          SELECT memories.id, memories.remote_id, memories.content, memories.metadata,
                 memories.user_id, memories.agent_id, memories.created_at, memories.updated_at,
                 bm25(memories_fts) AS score
          FROM memories_fts
          JOIN memories ON memories_fts.rowid = memories.id
          WHERE memories_fts MATCH ? ${where}
          ORDER BY score ASC
          LIMIT ?
        `);
        const rows = stmt.all(params.query, ...values, params.limit) as Array<{
          id: number;
          remote_id: string | null;
          content: string;
          metadata: string | null;
          user_id: string | null;
          agent_id: string | null;
          created_at: string;
          updated_at: string;
          score: number;
        }>;
        return rows.map((row) => ({
          id: row.id,
          remote_id: row.remote_id,
          content: row.content,
          metadata: safeJsonParse(row.metadata),
          user_id: row.user_id,
          agent_id: row.agent_id,
          created_at: row.created_at,
          updated_at: row.updated_at,
          score: 1 / (1 + Math.max(0, row.score ?? 0)),
        }));
      } catch (err) {
        this.logger?.warn?.(`local-sqlite: fts search failed, fallback: ${String(err)}`);
      }
    }

    const clauses: string[] = [];
    const values: Array<string | number | null> = [];
    if (params.userId) {
      clauses.push("user_id = ?");
      values.push(params.userId);
    }
    if (params.agentId) {
      clauses.push("agent_id = ?");
      values.push(params.agentId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const stmt = this.db.prepare(`
      SELECT id, remote_id, content, metadata, user_id, agent_id, created_at, updated_at
      FROM memories
      ${where}
      ORDER BY updated_at DESC
      LIMIT 500
    `);
    const rows = stmt.all(...values) as Array<{
      id: number;
      remote_id: string | null;
      content: string;
      metadata: string | null;
      user_id: string | null;
      agent_id: string | null;
      created_at: string;
      updated_at: string;
    }>;

    const scored = rows
      .map((row) => {
        const score = tokenOverlap(tokens, tokenize(row.content));
        return {
          id: row.id,
          remote_id: row.remote_id,
          content: row.content,
          metadata: safeJsonParse(row.metadata),
          user_id: row.user_id,
          agent_id: row.agent_id,
          created_at: row.created_at,
          updated_at: row.updated_at,
          score,
        };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, params.limit);

    return scored;
  }

  searchVector(params: {
    embedding: number[];
    limit: number;
    userId?: string;
    agentId?: string;
  }): Array<LocalMemoryRow & { score: number }> {
    if (!this.vector.enabled || !this.vector.available) {
      return [];
    }
    if (params.embedding.length === 0) {
      return [];
    }
    if (!this.ensureVectorTable(params.embedding.length)) {
      return [];
    }
    const clauses: string[] = [];
    const values: Array<string | number | null> = [];
    if (params.userId) {
      clauses.push("m.user_id = ?");
      values.push(params.userId);
    }
    if (params.agentId) {
      clauses.push("m.agent_id = ?");
      values.push(params.agentId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const stmt = this.db.prepare(
      `SELECT m.id, m.remote_id, m.content, m.metadata, m.user_id, m.agent_id, m.created_at, m.updated_at,\n` +
        `       vec_distance_cosine(v.embedding, ?) AS dist\n` +
        `  FROM ${VECTOR_TABLE} v\n` +
        `  JOIN memories m ON m.id = v.rowid\n` +
        ` ${where}\n` +
        ` ORDER BY dist ASC\n` +
        ` LIMIT ?`,
    );
    const rows = stmt.all(
      vectorToBlob(params.embedding),
      ...values,
      params.limit,
    ) as Array<{
      id: number;
      remote_id: string | null;
      content: string;
      metadata: string | null;
      user_id: string | null;
      agent_id: string | null;
      created_at: string;
      updated_at: string;
      dist: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      remote_id: row.remote_id,
      content: row.content,
      metadata: safeJsonParse(row.metadata),
      user_id: row.user_id,
      agent_id: row.agent_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      score: 1 - row.dist,
    }));
  }

  enqueuePending(params: {
    localMemoryId?: number | null;
    content: string;
    metadata?: Record<string, unknown>;
    userId?: string;
    agentId?: string;
    infer: boolean;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO pending_writes (local_memory_id, content, metadata, user_id, agent_id, infer, queued_at, retries, next_retry_at, last_error)
      VALUES (@local_memory_id, @content, @metadata, @user_id, @agent_id, @infer, @queued_at, 0, @next_retry_at, NULL)
    `);
    stmt.run({
      local_memory_id: params.localMemoryId ?? null,
      content: params.content,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      user_id: params.userId ?? null,
      agent_id: params.agentId ?? null,
      infer: params.infer ? 1 : 0,
      queued_at: nowIso(),
      next_retry_at: nowIso(),
    });
  }

  listPending(limit = 200, readyOnly = true): PendingRow[] {
    const readyClause =
      readyOnly && this.hasNextRetryAt
        ? "WHERE next_retry_at IS NULL OR next_retry_at <= ?"
        : "";
    const lastErrorCol = this.hasLastError ? "last_error" : "NULL as last_error";
    const stmt = this.db.prepare(`
      SELECT id, local_memory_id, content, metadata, user_id, agent_id, infer, queued_at, retries, ${lastErrorCol}
      FROM pending_writes
      ${readyClause}
      ORDER BY id ASC
      LIMIT ?
    `);
    const rows = (readyOnly && this.hasNextRetryAt
      ? stmt.all(nowIso(), limit)
      : stmt.all(limit)) as Array<{
      id: number;
      local_memory_id: number | null;
      content: string;
      metadata: string | null;
      user_id: string | null;
      agent_id: string | null;
      infer: number;
      queued_at: string;
      retries: number;
      last_error: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      local_memory_id: row.local_memory_id,
      content: row.content,
      metadata: safeJsonParse(row.metadata),
      user_id: row.user_id,
      agent_id: row.agent_id,
      infer: row.infer !== 0,
      queued_at: row.queued_at,
      retries: row.retries,
      last_error: row.last_error ?? null,
    }));
  }

  removePending(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(", ");
    const stmt = this.db.prepare(`DELETE FROM pending_writes WHERE id IN (${placeholders})`);
    stmt.run(...ids);
  }

  scheduleRetries(ids: number[], nextRetryAt: string, lastError?: string): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(", ");
    if (this.hasLastError) {
      const stmt = this.db.prepare(
        `UPDATE pending_writes SET retries = retries + 1, next_retry_at = ?, last_error = ? WHERE id IN (${placeholders})`,
      );
      stmt.run(nextRetryAt, lastError ?? null, ...ids);
      return;
    }
    const stmt = this.db.prepare(
      `UPDATE pending_writes SET retries = retries + 1, next_retry_at = ? WHERE id IN (${placeholders})`,
    );
    stmt.run(nextRetryAt, ...ids);
  }

  pendingCount(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM pending_writes`);
    const row = stmt.get() as { count: number };
    return row?.count ?? 0;
  }

  close(): void {
    try {
      this.db.close();
    } catch (err) {
      this.logger?.warn?.(`local-sqlite: close failed: ${String(err)}`);
    }
  }
}
