/**
 * OpenClaw Memory (PowerMem) Plugin
 *
 * Long-term memory via PowerMem: intelligent extraction, Ebbinghaus
 * forgetting curve, multi-agent isolation. Supports two backends:
 * - CLI (default): runs pmem locally; SQLite + LLM from OpenClaw state / agents.defaults.model (optional .env).
 * - HTTP: powermem-server (e.g. --port 8000) for shared / enterprise setups.
 */

import { Type } from "@sinclair/typebox";
import type {
  OpenClawPluginApi,
  OpenClawPluginCliContext,
} from "openclaw/plugin-sdk/memory-core";
import type { OpenClawPluginServiceContext } from "openclaw/plugin-sdk";

import {
  powerMemConfigSchema,
  DEFAULT_PLUGIN_CONFIG,
  DEFAULT_PMEM_PATH,
  type PowerMemConfig,
} from "./config.js";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { PowerMemClient, type PowerMemSearchResult } from "./client.js";
import { PowerMemV2Client } from "./client-v2.js";
import { PowerMemCLIClient } from "./client-cli.js";
import { DualWriteClient } from "./dual-write-client.js";
import { createLocalEmbeddingFactory } from "./local-embedding.js";
import { LocalSqliteStore } from "./local-sqlite.js";
import { callLlm } from "./llm.js";
import { WalSession, walCapture as walCaptureCore } from "./wal.js";
import {
  buildDefaultSqlitePowermemEnv,
  buildPowermemCliProcessEnv,
} from "./openclaw-powermem-env.js";
import { resolvePmemExecutable } from "./resolve-powermem-cli.js";

type GatewayApi = OpenClawPluginApi & {
  config?: unknown;
  runtime?: {
    state?: { resolveStateDir?: (env?: NodeJS.ProcessEnv) => string };
    modelAuth?: {
      resolveApiKeyForProvider?: (params: {
        provider: string;
        cfg?: unknown;
      }) => Promise<{ apiKey?: string }>;
    };
  };
};

type Logger = { info?: (msg: string) => void; warn?: (msg: string) => void };

function resolveOpenClawStateDir(api: GatewayApi): string {
  const fn = api.runtime?.state?.resolveStateDir;
  if (typeof fn === "function") {
    try {
      return fn(process.env);
    } catch {
      /* ignore */
    }
  }
  return join(homedir(), ".openclaw");
}

function normalizeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase() === "auto") return undefined;
  return trimmed;
}

function resolveIdentityIds(
  cfg: PowerMemConfig,
  stateDir: string,
  logger: Logger,
): { userId: string; agentId: string } {
  const baseDir = join(stateDir, "powermem");
  const identityPath = join(baseDir, "identity.json");
  let stored: { userId?: string; agentId?: string } = {};
  try {
    const raw = readFileSync(identityPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      stored = parsed as { userId?: string; agentId?: string };
    }
  } catch {
    // ignore missing or invalid file
  }

  const userId = normalizeId(cfg.userId) ?? normalizeId(stored.userId) ?? `user-${randomUUID()}`;
  const agentId =
    normalizeId(cfg.agentId) ?? normalizeId(stored.agentId) ?? `agent-${randomUUID()}`;

  if (userId !== stored.userId || agentId !== stored.agentId) {
    try {
      mkdirSync(baseDir, { recursive: true });
      writeFileSync(identityPath, JSON.stringify({ userId, agentId }, null, 2), "utf-8");
    } catch (err) {
      logger.warn?.(`memory-powermem: failed to persist identity: ${String(err)}`);
    }
  }

  return { userId, agentId };
}

type AgentIdentity = { userId: string; agentId: string };

function loadAgentIdentityMap(
  identityPath: string,
  logger: Logger,
): Map<string, AgentIdentity> {
  const map = new Map<string, AgentIdentity>();
  try {
    const raw = readFileSync(identityPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, AgentIdentity>;
    if (parsed && typeof parsed === "object") {
      for (const [agentId, identity] of Object.entries(parsed)) {
        if (
          identity &&
          typeof identity === "object" &&
          typeof identity.userId === "string" &&
          typeof identity.agentId === "string"
        ) {
          map.set(agentId, { userId: identity.userId, agentId: identity.agentId });
        }
      }
    }
  } catch (err) {
    if (String(err).includes("ENOENT")) {
      return map;
    }
    logger.warn?.(`memory-powermem: failed to load agent identity map: ${String(err)}`);
  }
  return map;
}

function saveAgentIdentityMap(
  identityPath: string,
  map: Map<string, AgentIdentity>,
  logger: Logger,
): void {
  try {
    const dir = dirname(identityPath);
    mkdirSync(dir, { recursive: true });
    const payload: Record<string, AgentIdentity> = {};
    for (const [agentId, identity] of map.entries()) {
      payload[agentId] = identity;
    }
    writeFileSync(identityPath, JSON.stringify(payload, null, 2), "utf-8");
  } catch (err) {
    logger.warn?.(`memory-powermem: failed to save agent identity map: ${String(err)}`);
  }
}

type MemoryClient = {
  health: () => Promise<{ status: string; error?: string }>;
  add: (
    content: string,
    options?: { infer?: boolean; metadata?: Record<string, unknown> },
  ) => Promise<Array<{ memory_id: string | number; content: string; metadata?: Record<string, unknown> }>>;
  search: (query: string, limit?: number) => Promise<PowerMemSearchResult[]>;
  delete: (memoryId: number | string) => Promise<void>;
};

type AgentMemoryClient = {
  agentMemoryAdd?: (
    targetAgentId: string,
    content: string,
  ) => Promise<{ memory_id: string | number; content: string } | null>;
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

type CrossScopeIdentity = {
  userId: string;
  agentId: string;
};

type ToolContext = { agentId?: string } | undefined;

function resolveLocalDbPath(cfg: PowerMemConfig, stateDir: string): string {
  if (cfg.localDbPath && cfg.localDbPath.trim()) return cfg.localDbPath.trim();
  return join(stateDir, "powermem", "local-memories.sqlite");
}

// ============================================================================
// Plugin Definition
// ============================================================================

const memoryPlugin = {
  id: "memory-powermem",
  name: "Memory (PowerMem)",
  description:
    "PowerMem-backed long-term memory (intelligent extraction, forgetting curve). Default: local CLI (npm powermem / TS, or pmem on PATH); optional HTTP server for shared deployments.",
  kind: "memory" as const,
  configSchema: powerMemConfigSchema,

  register(api: OpenClawPluginApi) {
    const gw = api as GatewayApi;
    const raw = api.pluginConfig;
    const toParse =
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      Object.keys(raw).length > 0
        ? { ...DEFAULT_PLUGIN_CONFIG, ...raw }
        : DEFAULT_PLUGIN_CONFIG;
    const cfg = powerMemConfigSchema.parse(toParse) as PowerMemConfig;
    const stateDir = resolveOpenClawStateDir(gw);
    const { userId, agentId } = resolveIdentityIds(cfg, stateDir, api.logger);
    const buildProcessEnv =
      cfg.mode === "cli"
        ? cfg.useOpenClawModel !== false
          ? () =>
              buildPowermemCliProcessEnv({
                openclawConfig: gw.config,
                stateDir,
                resolveProviderAuth: async (provider) => {
                  const fn = gw.runtime?.modelAuth?.resolveApiKeyForProvider;
                  if (typeof fn !== "function") return {};
                  try {
                    return await fn({ provider, cfg: gw.config });
                  } catch {
                    return {};
                  }
                },
                warn: (m) => api.logger.warn(m),
              })
          : () => Promise.resolve(buildDefaultSqlitePowermemEnv(stateDir))
        : undefined;

    const defaultIdentity: AgentIdentity = { userId, agentId };
    const agentIdentityPath = join(stateDir, "powermem", "agent-identities.json");
    const agentIdentityMap = loadAgentIdentityMap(agentIdentityPath, api.logger);
    let defaultIdentityBound = agentIdentityMap.size > 0;

    const resolveAgentIdentity = (ctxAgentId?: string): AgentIdentity => {
      if (!ctxAgentId) return defaultIdentity;
      const cached = agentIdentityMap.get(ctxAgentId);
      if (cached) return cached;
      const identity = defaultIdentityBound
        ? { userId: `user-${randomUUID()}`, agentId: `agent-${randomUUID()}` }
        : defaultIdentity;
      defaultIdentityBound = true;
      agentIdentityMap.set(ctxAgentId, identity);
      saveAgentIdentityMap(agentIdentityPath, agentIdentityMap, api.logger);
      return identity;
    };

    const resolveLocalIdentity = (identity: AgentIdentity): AgentIdentity => ({
      userId: cfg.localUserId ?? identity.userId,
      agentId: cfg.localAgentId ?? identity.agentId,
    });

    const localStore = cfg.dualWrite
      ? new LocalSqliteStore(resolveLocalDbPath(cfg, stateDir), {
          logger: api.logger,
          vector: {
            enabled: cfg.localVector?.enabled ?? (cfg.dualWrite === true),
            extensionPath: cfg.localVector?.extensionPath,
          },
        })
      : null;

    const embeddingFactoryCache = new Map<string, ReturnType<typeof createLocalEmbeddingFactory> | null>();
    const getLocalEmbeddingFactory = (ctxAgentId?: string) => {
      if (!cfg.dualWrite) return null;
      const key = ctxAgentId ?? "__default__";
      if (embeddingFactoryCache.has(key)) {
        return embeddingFactoryCache.get(key) ?? null;
      }
      const localEmbedding = createLocalEmbeddingFactory({
        api: gw,
        cfg,
        agentId: ctxAgentId ?? agentId,
        logger: api.logger,
      });
      embeddingFactoryCache.set(key, localEmbedding);
      return localEmbedding;
    };

    const clientCache = new Map<string, MemoryClient & AgentMemoryClient>();
    const walSession = new WalSession();

    const buildHttpClient = (identity: AgentIdentity) =>
      cfg.httpApiVersion === "v2"
        ? PowerMemV2Client.fromConfig(cfg, identity.userId, identity.agentId)
        : PowerMemClient.fromConfig(cfg, identity.userId, identity.agentId);

    const createClientForIdentity = (identity: AgentIdentity, ctxAgentId?: string) => {
      if (cfg.mode === "cli") {
        return PowerMemCLIClient.fromConfig(cfg, identity.userId, identity.agentId, {
          buildProcessEnv,
        }) as MemoryClient;
      }

      const httpClient = buildHttpClient(identity);
      if (cfg.dualWrite && localStore) {
        const localIdentity = resolveLocalIdentity(identity);
        const localEmbedding = getLocalEmbeddingFactory(ctxAgentId);
        return new DualWriteClient(httpClient, localStore, {
          localUserId: localIdentity.userId,
          localAgentId: localIdentity.agentId,
          syncOnResume: cfg.syncOnResume !== false,
          syncBatchSize: cfg.syncBatchSize ?? 50,
          syncMinIntervalMs: cfg.syncMinIntervalMs ?? 5000,
          syncBaseDelayMs: cfg.syncBaseDelayMs ?? 5000,
          syncMaxDelayMs: cfg.syncMaxDelayMs ?? 60000,
          syncMaxRetries: cfg.syncMaxRetries ?? 10,
          embedding: localEmbedding,
          logger: api.logger,
        }) as MemoryClient & AgentMemoryClient;
      }

      return httpClient as MemoryClient & AgentMemoryClient;
    };

    const getClientForAgent = (ctxAgentId?: string) => {
      const key = ctxAgentId ?? "__default__";
      const cached = clientCache.get(key);
      if (cached) return cached;
      const identity = resolveAgentIdentity(ctxAgentId);
      const created = createClientForIdentity(identity, ctxAgentId);
      clientCache.set(key, created);
      return created;
    };

    const client = getClientForAgent();
    if (cfg.dualWrite && "syncPending" in client) {
      void (client as DualWriteClient).syncPending("startup");
    }
    const resolvedPmem =
      cfg.mode === "cli" ? resolvePmemExecutable(cfg.pmemPath ?? DEFAULT_PMEM_PATH) : "";
    const modeLabel =
      cfg.mode === "cli"
        ? `cli (${resolvedPmem})`
        : `${cfg.baseUrl}${cfg.httpApiVersion === "v2" ? " (v2)" : ""}${cfg.dualWrite ? " + sqlite" : ""}`;

    api.logger.info(
      `memory-powermem: plugin registered (mode: ${cfg.mode}, ${modeLabel}, user: ${userId}, agent: ${agentId})`,
    );

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      (ctx: ToolContext) => ({
        name: "memory_recall",
        label: "Memory Recall",
        description:
          "Search through long-term memories. Use when you need context about user preferences, past decisions, or previously discussed topics.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          limit: Type.Optional(
            Type.Number({ description: "Max results (default: plugin recallLimit)" }),
          ),
          scoreThreshold: Type.Optional(
            Type.Number({ description: "Min score 0–1 to include (default: plugin recallScoreThreshold)" }),
          ),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const agentClient = getClientForAgent(ctx?.agentId);
          const limit =
            typeof (params as { limit?: number }).limit === "number"
              ? Math.max(1, Math.min(100, Math.floor((params as { limit: number }).limit)))
              : cfg.recallLimit ?? 5;
          const scoreThreshold =
            typeof (params as { scoreThreshold?: number }).scoreThreshold === "number"
              ? Math.max(0, Math.min(1, (params as { scoreThreshold: number }).scoreThreshold))
              : (cfg.recallScoreThreshold ?? 0);
          const query = String((params as { query?: string }).query ?? "");

          try {
            const requestLimit = Math.min(100, Math.max(limit * 2, limit + 10));
            const raw = await agentClient.search(query, requestLimit);
            const results = raw
              .filter((r) => (r.score ?? 0) >= scoreThreshold)
              .slice(0, limit);

            if (results.length === 0) {
              return {
                content: [{ type: "text", text: "No relevant memories found." }],
                details: { count: 0 },
              };
            }

            const text = results
              .map(
                (r, i) =>
                  `${i + 1}. ${r.content} (${((r.score ?? 0) * 100).toFixed(0)}%)`,
              )
              .join("\n");

            const sanitizedResults = results.map((r) => ({
              id: String(r.memory_id),
              text: r.content,
              score: r.score,
            }));

            return {
              content: [
                { type: "text", text: `Found ${results.length} memories:\n\n${text}` },
              ],
              details: { count: results.length, memories: sanitizedResults },
            };
          } catch (err) {
            api.logger.warn(`memory-powermem: recall failed: ${String(err)}`);
            return {
              content: [
                {
                  type: "text",
                  text: `Memory search failed: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "memory_recall" },
    );

    api.registerTool(
      (ctx: ToolContext) => ({
        name: "memory_store",
        label: "Memory Store",
        description:
          "Save important information in long-term memory. Use for preferences, facts, decisions.",
        parameters: Type.Object({
          text: Type.String({ description: "Information to remember" }),
          importance: Type.Optional(
            Type.Number({ description: "Importance 0-1 (default: 0.7)" }),
          ),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const agentClient = getClientForAgent(ctx?.agentId);
          const { text, importance = 0.7 } = params as {
            text: string;
            importance?: number;
          };

          try {
            const created = await agentClient.add(text, {
              infer: cfg.inferOnAdd,
              metadata: { importance },
            });

            if (created.length === 0) {
              return {
                content: [{ type: "text", text: "Stored (no inferred items)." }],
                details: { action: "created" },
              };
            }

            const summary =
              created.length === 1
                ? created[0].content.slice(0, 80)
                : `${created.length} items stored`;
            return {
              content: [
                { type: "text", text: `Stored: ${summary}${summary.length >= 80 ? "..." : ""}` },
              ],
              details: {
                action: "created",
                count: created.length,
                ids: created.map((c) => String(c.memory_id)),
              },
            };
          } catch (err) {
            api.logger.warn(`memory-powermem: store failed: ${String(err)}`);
            return {
              content: [
                {
                  type: "text",
                  text: `Failed to store memory: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "memory_store" },
    );

    api.registerTool(
      (ctx: ToolContext) => ({
        name: "memory_forget",
        label: "Memory Forget",
        description: "Delete specific memories. GDPR-compliant.",
        parameters: Type.Object({
          query: Type.Optional(Type.String({ description: "Search to find memory" })),
          memoryId: Type.Optional(Type.String({ description: "Specific memory ID" })),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const agentClient = getClientForAgent(ctx?.agentId);
          const { query, memoryId } = params as { query?: string; memoryId?: string };

          try {
            if (memoryId) {
              await agentClient.delete(memoryId);
              return {
                content: [{ type: "text", text: `Memory ${memoryId} forgotten.` }],
                details: { action: "deleted", id: memoryId },
              };
            }

            if (query) {
              const results = await agentClient.search(query, 5);
              if (results.length === 0) {
                return {
                  content: [{ type: "text", text: "No matching memories found." }],
                  details: { found: 0 },
                };
              }
              if (results.length === 1 && (results[0].score ?? 0) > 0.9) {
                await agentClient.delete(results[0].memory_id);
                return {
                  content: [
                    {
                      type: "text",
                      text: `Forgotten: "${results[0].content.slice(0, 60)}..."`,
                    },
                  ],
                  details: { action: "deleted", id: String(results[0].memory_id) },
                };
              }
              const list = results
                .map(
                  (r) =>
                    `- [${String(r.memory_id).slice(0, 8)}] ${r.content.slice(0, 60)}...`,
                )
                .join("\n");
              return {
                content: [
                  {
                    type: "text",
                    text: `Found ${results.length} candidates. Specify memoryId:\n${list}`,
                  },
                ],
                details: {
                  action: "candidates",
                  candidates: results.map((r) => ({
                    id: String(r.memory_id),
                    text: r.content,
                    score: r.score,
                  })),
                },
              };
            }

            return {
              content: [{ type: "text", text: "Provide query or memoryId." }],
              details: { error: "missing_param" },
            };
          } catch (err) {
            api.logger.warn(`memory-powermem: forget failed: ${String(err)}`);
            return {
              content: [
                {
                  type: "text",
                  text: `Failed to forget: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "memory_forget" },
    );

    api.registerTool(
      (ctx: ToolContext) => ({
        name: "experience_store",
        label: "Experience Store",
        description: "Store a procedural experience or lesson learned.",
        parameters: Type.Object({
          text: Type.String({ description: "Experience content" }),
          importance: Type.Optional(
            Type.Number({ description: "Importance 0-1 (default: 0.7)" }),
          ),
          tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tags" })),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const agentClient = getClientForAgent(ctx?.agentId);
          const { text, importance = 0.7, tags } = params as {
            text: string;
            importance?: number;
            tags?: string[];
          };
          try {
            const created = await agentClient.add(text, {
              infer: false,
              metadata: { type: "experience", importance, tags },
            });
            const id = created[0]?.memory_id ? String(created[0].memory_id) : "unknown";
            return {
              content: [{ type: "text", text: `Experience stored (id: ${id}).` }],
              details: { action: "created", id },
            };
          } catch (err) {
            api.logger.warn(`memory-powermem: experience_store failed: ${String(err)}`);
            return {
              content: [
                {
                  type: "text",
                  text: `Failed to store experience: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "experience_store" },
    );

    api.registerTool(
      (ctx: ToolContext) => ({
        name: "experience_recall",
        label: "Experience Recall",
        description: "Search stored experiences for procedural guidance.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          limit: Type.Optional(
            Type.Number({ description: "Max results (default: plugin recallLimit)" }),
          ),
          scoreThreshold: Type.Optional(
            Type.Number({ description: "Min score 0–1 to include (default: plugin recallScoreThreshold)" }),
          ),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const agentClient = getClientForAgent(ctx?.agentId);
          const limit =
            typeof (params as { limit?: number }).limit === "number"
              ? Math.max(1, Math.min(100, Math.floor((params as { limit: number }).limit)))
              : cfg.recallLimit ?? 5;
          const scoreThreshold =
            typeof (params as { scoreThreshold?: number }).scoreThreshold === "number"
              ? Math.max(0, Math.min(1, (params as { scoreThreshold: number }).scoreThreshold))
              : (cfg.recallScoreThreshold ?? 0);
          const query = String((params as { query?: string }).query ?? "");

          try {
            const requestLimit = Math.min(100, Math.max(limit * 2, limit + 10));
            const raw = await agentClient.search(query, requestLimit);
            const { experiences } = splitExperiences(raw);
            const results = experiences
              .filter((r) => (r.score ?? 0) >= scoreThreshold)
              .slice(0, limit);

            if (results.length === 0) {
              return {
                content: [{ type: "text", text: "No relevant experiences found." }],
                details: { count: 0 },
              };
            }

            const text = results
              .map(
                (r, i) =>
                  `${i + 1}. ${r.content} (${((r.score ?? 0) * 100).toFixed(0)}%)`,
              )
              .join("\n");

            return {
              content: [
                { type: "text", text: `Found ${results.length} experiences:\n\n${text}` },
              ],
              details: { count: results.length },
            };
          } catch (err) {
            api.logger.warn(`memory-powermem: experience_recall failed: ${String(err)}`);
            return {
              content: [
                {
                  type: "text",
                  text: `Experience search failed: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "experience_recall" },
    );

    if (cfg.httpApiVersion === "v2") {
      const createScopedV2Client = (identity: CrossScopeIdentity) =>
        new PowerMemV2Client({
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          userId: identity.userId,
          agentId: identity.agentId,
          requestConfig: cfg.requestConfig,
          timeoutMs: cfg.requestTimeoutMs,
        });

      api.registerTool(
        (ctx: ToolContext) => ({
          name: "agent_memory_add",
          label: "Agent Memory Add",
          description: "Add memory to a target agent's memory pool (v2 only).",
          parameters: Type.Object({
            agentId: Type.String({ description: "Target agent ID" }),
            text: Type.String({ description: "Memory content" }),
          }),
          async execute(_toolCallId: string, params: Record<string, unknown>) {
            const agentClient = getClientForAgent(ctx?.agentId) as AgentMemoryClient;
            if (!agentClient.agentMemoryAdd) {
              return {
                content: [{ type: "text", text: "Agent memory add not available in this mode." }],
                details: { error: "unsupported" },
              };
            }
            const { agentId, text } = params as { agentId: string; text: string };
            try {
              const record = await agentClient.agentMemoryAdd(agentId, text);
              const id = record?.memory_id ? String(record.memory_id) : "unknown";
              return {
                content: [{ type: "text", text: `Agent memory stored (id: ${id}).` }],
                details: { action: "created", id },
              };
            } catch (err) {
              api.logger.warn(`memory-powermem: agent_memory_add failed: ${String(err)}`);
              return {
                content: [
                  {
                    type: "text",
                    text: `Failed to add agent memory: ${err instanceof Error ? err.message : String(err)}`,
                  },
                ],
                details: { error: String(err) },
              };
            }
          },
        }),
        { name: "agent_memory_add" },
      );

      api.registerTool(
        (ctx: ToolContext) => ({
          name: "agent_memory_share",
          label: "Agent Memory Share",
          description: "Share memories from one agent to another (v2 only).",
          parameters: Type.Object({
            fromAgentId: Type.Optional(Type.String({ description: "Source agent ID (default: current)" })),
            targetAgentId: Type.String({ description: "Target agent ID" }),
            memoryIds: Type.Optional(
              Type.Array(Type.Number(), { description: "Specific memory IDs to share (optional)" }),
            ),
          }),
          async execute(_toolCallId: string, params: Record<string, unknown>) {
            const agentClient = getClientForAgent(ctx?.agentId) as AgentMemoryClient;
            if (!agentClient.agentMemoryShare) {
              return {
                content: [{ type: "text", text: "Agent memory share not available in this mode." }],
                details: { error: "unsupported" },
              };
            }
            const { fromAgentId, targetAgentId, memoryIds } = params as {
              fromAgentId?: string;
              targetAgentId: string;
              memoryIds?: number[];
            };
            const currentSource = resolveAgentIdentity(ctx?.agentId).agentId;
            if (fromAgentId && fromAgentId !== currentSource) {
              return {
                content: [
                  {
                    type: "text",
                    text:
                      "fromAgentId does not match the current agent identity. " +
                      "Leave fromAgentId empty to use current agent automatically.",
                  },
                ],
                details: {
                  error: "from_agent_mismatch",
                  currentAgentId: currentSource,
                },
              };
            }
            const source = fromAgentId ?? currentSource;
            try {
              const result = await agentClient.agentMemoryShare(source, targetAgentId, memoryIds);
              const shared = result?.shared_count ?? 0;
              return {
                content: [
                  { type: "text", text: `Shared ${shared} memories to agent ${targetAgentId}.` },
                ],
                details: { shared },
              };
            } catch (err) {
              api.logger.warn(`memory-powermem: agent_memory_share failed: ${String(err)}`);
              return {
                content: [
                  {
                    type: "text",
                    text: `Failed to share agent memories: ${err instanceof Error ? err.message : String(err)}`,
                  },
                ],
                details: { error: String(err) },
              };
            }
          },
        }),
        { name: "agent_memory_share" },
      );

      api.registerTool(
        (_ctx: ToolContext) => ({
          name: "cross_scope_share",
          label: "Cross Scope Share",
          description:
            "Share memories across arbitrary userId/agentId scopes by copying matched memories.",
          parameters: Type.Object({
            fromUserId: Type.String({ description: "Source user ID" }),
            fromAgentId: Type.String({ description: "Source agent ID" }),
            toUserId: Type.String({ description: "Target user ID" }),
            toAgentId: Type.String({ description: "Target agent ID" }),
            query: Type.String({ description: "Search query in source scope" }),
            limit: Type.Optional(
              Type.Number({ description: "Max memories to copy (default: 20, range: 1-100)" }),
            ),
            scoreThreshold: Type.Optional(
              Type.Number({ description: "Min score 0-1 to include (default: plugin recallScoreThreshold)" }),
            ),
            inferOnTarget: Type.Optional(
              Type.Boolean({ description: "Whether target writes should infer memory extraction (default: false)" }),
            ),
          }),
          async execute(_toolCallId: string, params: Record<string, unknown>) {
            const {
              fromUserId,
              fromAgentId,
              toUserId,
              toAgentId,
              query,
              limit = 20,
              scoreThreshold,
              inferOnTarget = false,
            } = params as {
              fromUserId: string;
              fromAgentId: string;
              toUserId: string;
              toAgentId: string;
              query: string;
              limit?: number;
              scoreThreshold?: number;
              inferOnTarget?: boolean;
            };

            const srcUser = fromUserId?.trim();
            const srcAgent = fromAgentId?.trim();
            const dstUser = toUserId?.trim();
            const dstAgent = toAgentId?.trim();
            const q = query?.trim();
            if (!srcUser || !srcAgent || !dstUser || !dstAgent) {
              return {
                content: [{ type: "text", text: "fromUserId/fromAgentId/toUserId/toAgentId are required." }],
                details: { error: "missing_identity" },
              };
            }
            if (!q) {
              return {
                content: [{ type: "text", text: "query is required for cross_scope_share." }],
                details: { error: "missing_query" },
              };
            }

            const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
            const threshold =
              typeof scoreThreshold === "number"
                ? Math.max(0, Math.min(1, scoreThreshold))
                : (cfg.recallScoreThreshold ?? 0);

            const sourceIdentity: CrossScopeIdentity = { userId: srcUser, agentId: srcAgent };
            const targetIdentity: CrossScopeIdentity = { userId: dstUser, agentId: dstAgent };
            const sourceClient = createScopedV2Client(sourceIdentity);
            const targetClient = createScopedV2Client(targetIdentity);

            try {
              const requestLimit = Math.min(100, Math.max(boundedLimit * 2, boundedLimit + 10));
              const sourceRows = await sourceClient.search(q, requestLimit);
              const selected = sourceRows
                .filter((row) => (row.score ?? 0) >= threshold)
                .slice(0, boundedLimit);

              if (selected.length === 0) {
                return {
                  content: [{ type: "text", text: "No source memories matched for cross-scope sharing." }],
                  details: { copied: 0, scanned: sourceRows.length },
                };
              }

              let copied = 0;
              const copiedIds: string[] = [];
              const sharedAt = new Date().toISOString();
              for (const row of selected) {
                const metadata = {
                  ...(row.metadata ?? {}),
                  shared_via: "cross_scope_share",
                  shared_at: sharedAt,
                  shared_from_user_id: sourceIdentity.userId,
                  shared_from_agent_id: sourceIdentity.agentId,
                  shared_from_memory_id: String(row.memory_id),
                };
                const created = await targetClient.add(row.content, {
                  infer: inferOnTarget,
                  metadata,
                });
                copied += created.length;
                for (const item of created) {
                  copiedIds.push(String(item.memory_id));
                }
              }

              return {
                content: [
                  {
                    type: "text",
                    text:
                      `Cross-scope share completed: copied ${copied} memories ` +
                      `from ${sourceIdentity.userId}/${sourceIdentity.agentId} ` +
                      `to ${targetIdentity.userId}/${targetIdentity.agentId}.`,
                  },
                ],
                details: {
                  copied,
                  requestedLimit: boundedLimit,
                  selected: selected.length,
                  source: sourceIdentity,
                  target: targetIdentity,
                  copiedIds,
                },
              };
            } catch (err) {
              api.logger.warn(`memory-powermem: cross_scope_share failed: ${String(err)}`);
              return {
                content: [
                  {
                    type: "text",
                    text: `Failed to share across scopes: ${err instanceof Error ? err.message : String(err)}`,
                  },
                ],
                details: { error: String(err) },
              };
            }
          },
        }),
        { name: "cross_scope_share" },
      );

      api.registerTool(
        (ctx: ToolContext) => ({
          name: "agent_memory_list",
          label: "Agent Memory List",
          description: "List memories owned by an agent (v2 only).",
          parameters: Type.Object({
            agentId: Type.String({ description: "Target agent ID" }),
            limit: Type.Optional(Type.Number({ description: "Max results (default: 20)" })),
            offset: Type.Optional(Type.Number({ description: "Offset (default: 0)" })),
          }),
          async execute(_toolCallId: string, params: Record<string, unknown>) {
            const agentClient = getClientForAgent(ctx?.agentId) as AgentMemoryClient;
            if (!agentClient.agentMemoryList) {
              return {
                content: [{ type: "text", text: "Agent memory list not available in this mode." }],
                details: { error: "unsupported" },
              };
            }
            const { agentId: targetAgentId, limit = 20, offset = 0 } = params as {
              agentId: string;
              limit?: number;
              offset?: number;
            };
            try {
              const rows = await agentClient.agentMemoryList(targetAgentId, limit, offset);
              const list = rows ?? [];
              const text = list
                .map((row, idx) => `${idx + 1}. ${String(row.content ?? "").slice(0, 80)}`)
                .join("\n");
              return {
                content: [
                  { type: "text", text: list.length ? text : "No agent memories found." },
                ],
                details: { count: list.length },
              };
            } catch (err) {
              api.logger.warn(`memory-powermem: agent_memory_list failed: ${String(err)}`);
              return {
                content: [
                  {
                    type: "text",
                    text: `Failed to list agent memories: ${err instanceof Error ? err.message : String(err)}`,
                  },
                ],
                details: { error: String(err) },
              };
            }
          },
        }),
        { name: "agent_memory_list" },
      );

      api.registerTool(
        (ctx: ToolContext) => ({
          name: "agent_memory_shared",
          label: "Agent Memory Shared",
          description: "List memories shared with an agent (v2 only).",
          parameters: Type.Object({
            agentId: Type.String({ description: "Target agent ID" }),
            limit: Type.Optional(Type.Number({ description: "Max results (default: 20)" })),
            offset: Type.Optional(Type.Number({ description: "Offset (default: 0)" })),
          }),
          async execute(_toolCallId: string, params: Record<string, unknown>) {
            const agentClient = getClientForAgent(ctx?.agentId) as AgentMemoryClient;
            if (!agentClient.agentMemoryShared) {
              return {
                content: [{ type: "text", text: "Agent memory shared not available in this mode." }],
                details: { error: "unsupported" },
              };
            }
            const { agentId: targetAgentId, limit = 20, offset = 0 } = params as {
              agentId: string;
              limit?: number;
              offset?: number;
            };
            try {
              const rows = await agentClient.agentMemoryShared(targetAgentId, limit, offset);
              const list = rows ?? [];
              const text = list
                .map((row, idx) => `${idx + 1}. ${String(row.content ?? "").slice(0, 80)}`)
                .join("\n");
              return {
                content: [
                  { type: "text", text: list.length ? text : "No shared memories found." },
                ],
                details: { count: list.length },
              };
            } catch (err) {
              api.logger.warn(`memory-powermem: agent_memory_shared failed: ${String(err)}`);
              return {
                content: [
                  {
                    type: "text",
                    text: `Failed to list shared memories: ${err instanceof Error ? err.message : String(err)}`,
                  },
                ],
                details: { error: String(err) },
              };
            }
          },
        }),
        { name: "agent_memory_shared" },
      );
    }

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }: OpenClawPluginCliContext) => {
        const ltm = program
          .command("ltm")
          .description("PowerMem long-term memory plugin commands");

        ltm
          .command("search")
          .description("Search memories")
          .argument("<query>", "Search query")
          .option("--limit <n>", "Max results", "5")
          .option("--score-threshold <n>", "Min score (0-1) to keep")
          .action(async (...args: unknown[]) => {
            const query = String(args[0] ?? "");
            const opts = (args[1] ?? {}) as { limit?: string; scoreThreshold?: string };
            const limit = parseInt(opts.limit ?? "5", 10);
            const rawThreshold = opts.scoreThreshold?.trim();
            const threshold =
              rawThreshold && Number.isFinite(Number(rawThreshold))
                ? Math.max(0, Math.min(1, Number(rawThreshold)))
                : undefined;
            const results = await client.search(query, limit);
            const filtered =
              threshold === undefined
                ? results
                : results.filter((r) => (r.score ?? 0) >= threshold);
            console.log(JSON.stringify(filtered, null, 2));
          });

        ltm
          .command("health")
          .description("Check PowerMem server health")
          .action(async () => {
            try {
              const h = await client.health();
              console.log("PowerMem:", h.status);
              if (h.status !== "healthy" && "error" in h && h.error) {
                console.error(h.error);
              }
            } catch (err) {
              console.error("PowerMem health check failed:", err);
              process.exitCode = 1;
            }
          });

        ltm
          .command("add")
          .description("Manually add a memory (for testing or one-off storage)")
          .argument("<text>", "Content to store")
          .action(async (...args: unknown[]) => {
            const text = String(args[0] ?? "");
            try {
              const created = await client.add(text.trim(), { infer: cfg.inferOnAdd });
              if (created.length === 0) {
                console.log("Stored (no inferred items).");
              } else {
                console.log(`Stored ${created.length} item(s):`, created.map((c) => c.memory_id));
              }
            } catch (err) {
              console.error("PowerMem add failed:", err);
              process.exitCode = 1;
            }
          });
      },
      { commands: ["ltm"] },
    );

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================

    const MEMORY_RECALL_GUIDANCE =
      "## Long-term memory (PowerMem)\n" +
      "When answering about past events, user preferences, people, or anything the user may have told you before: use the memory_recall tool to search long-term memory first, or use any <relevant-memories> already injected in this turn.\n" +
      "When you need procedural guidance or lessons learned, consider experience_recall or <relevant-experiences> if available.\n";

    function lastUserMessageText(messages: unknown[] | undefined): string {
      if (!Array.isArray(messages) || messages.length === 0) return "";
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!msg || typeof msg !== "object") continue;
        const role = (msg as Record<string, unknown>).role;
        if (role !== "user") continue;
        const content = (msg as Record<string, unknown>).content;
        if (typeof content === "string" && content.trim().length >= 5) return content.trim();
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              block &&
              typeof block === "object" &&
              (block as Record<string, unknown>).type === "text" &&
              typeof (block as Record<string, unknown>).text === "string"
            ) {
              const t = String((block as Record<string, unknown>).text).trim();
              if (t.length >= 5) return t;
            }
          }
        }
      }
      return "";
    }

    function extractText(content: unknown): string {
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .filter(
            (block) =>
              block &&
              typeof block === "object" &&
              (block as Record<string, unknown>).type === "text" &&
              typeof (block as Record<string, unknown>).text === "string",
          )
          .map((block) => String((block as Record<string, unknown>).text))
          .join("\n");
      }
      return "";
    }

    function extractToolNames(messages: unknown[]): string[] {
      const names = new Set<string>();
      for (const msg of messages) {
        if (!msg || typeof msg !== "object") continue;
        const msgObj = msg as Record<string, unknown>;
        const role = msgObj.role;
        if (role === "tool" || role === "toolResult") {
          const toolName = msgObj.name ?? msgObj.toolName;
          if (typeof toolName === "string" && toolName.trim()) {
            names.add(toolName.trim());
          }
        }
        const content = msgObj.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (!block || typeof block !== "object") continue;
            const blockObj = block as Record<string, unknown>;
            const type = blockObj.type;
            if ((type === "tool_use" || type === "toolCall") && typeof blockObj.name === "string") {
              names.add(blockObj.name);
            }
          }
        }
      }
      return Array.from(names);
    }

    function lastRoleText(messages: unknown[], role: string): string {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!msg || typeof msg !== "object") continue;
        const msgObj = msg as Record<string, unknown>;
        if (msgObj.role !== role) continue;
        const text = extractText(msgObj.content);
        if (text.trim()) return text.trim();
      }
      return "";
    }

    const EXPERIENCE_SYSTEM_PROMPT =
      "You are extracting durable procedural experiences from an agent session.\n" +
      "Return a JSON array of 1-3 concise experience statements. Each item should be actionable guidance\n" +
      "that can help future tasks. Avoid sensitive data, greetings, or boilerplate.\n" +
      "Output ONLY valid JSON array of strings, no extra text.";

    function buildExperiencePrompt(messages: unknown[]): string {
      const recent = Array.isArray(messages)
        ? messages.filter((m) => m && typeof m === "object").slice(-12)
        : [];
      const lines = recent
        .map((msg) => {
          const obj = msg as Record<string, unknown>;
          const role = typeof obj.role === "string" ? obj.role : "unknown";
          const text = extractText(obj.content).slice(0, 800);
          if (!text.trim()) return "";
          return `${role}: ${text}`;
        })
        .filter(Boolean);
      return lines.join("\n");
    }

    function parseExperienceList(raw: string | null): string[] {
      if (!raw) return [];
      const trimmed = raw.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((item) => typeof item === "string")
            .map((item) => item.trim())
            .filter((item) => item.length >= 20);
        }
      } catch {
        // fall through
      }
      return trimmed
        .split("\n")
        .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
        .filter((line) => line.length >= 20);
    }

    async function extractExperiencesWithLlm(messages: unknown[]): Promise<string[]> {
      const prompt = buildExperiencePrompt(messages);
      if (!prompt.trim()) return [];
      const reply = await callLlm(api, prompt, {
        systemPrompt: EXPERIENCE_SYSTEM_PROMPT,
        maxTokens: 512,
        temperature: 0.2,
      });
      const list = parseExperienceList(reply).slice(0, 3);
      return list;
    }

    function splitExperiences(results: PowerMemSearchResult[]): {
      memories: PowerMemSearchResult[];
      experiences: PowerMemSearchResult[];
    } {
      const memories: PowerMemSearchResult[] = [];
      const experiences: PowerMemSearchResult[] = [];
      for (const r of results) {
        const meta = r.metadata ?? {};
        const kind = typeof meta.type === "string" ? meta.type : "";
        if (kind === "experience") experiences.push(r);
        else memories.push(r);
      }
      return { memories, experiences };
    }

    async function walCapture(prompt: string, sessionKey: string, ctxAgentId?: string): Promise<void> {
      const agentClient = getClientForAgent(ctxAgentId);
      await walCaptureCore(prompt, sessionKey, walSession, {
        callLlm: (p, opts) => callLlm(api, p, opts),
        store: async (content, metadata) => {
          const created = await agentClient.add(content, { infer: false, metadata });
          const id = created[0]?.memory_id;
          return { id };
        },
        logger: api.logger,
      });
    }

    if (cfg.autoRecall) {
      api.on("before_agent_start", async (...args: unknown[]) => {
        const [event, ctx] = args as [unknown, ToolContext];
        const agentClient = getClientForAgent(ctx?.agentId);
        const e = event as { prompt: string; messages?: unknown[] };
        const query =
          (typeof e.prompt === "string" && e.prompt.trim().length >= 5
            ? e.prompt.trim()
            : lastUserMessageText(e.messages)) || "";
        if (query.length < 5) {
          return { prependSystemContext: MEMORY_RECALL_GUIDANCE };
        }

        const recallLimit = Math.max(1, Math.min(100, cfg.recallLimit ?? 5));
        const scoreThreshold = Math.max(0, Math.min(1, cfg.recallScoreThreshold ?? 0));

        try {
          const requestLimit = Math.min(100, Math.max(recallLimit * 2, recallLimit + 10));
          const raw = await agentClient.search(query, requestLimit);
          const { memories, experiences } = splitExperiences(raw);
          const memoryResults = memories
            .filter((r) => (r.score ?? 0) >= scoreThreshold)
            .slice(0, recallLimit);
          const experienceResults = cfg.experienceRecall
            ? experiences.filter((r) => (r.score ?? 0) >= scoreThreshold).slice(0, recallLimit)
            : [];

          const memoryContext =
            memoryResults.length > 0
              ? memoryResults.map((r) => `- ${r.content}`).join("\n")
              : "";
          const experienceContext =
            experienceResults.length > 0
              ? experienceResults.map((r) => `- ${r.content}`).join("\n")
              : "";

          const contexts: string[] = [];
          if (memoryContext) {
            contexts.push(
              `<relevant-memories>\nThe following memories may be relevant to this conversation:\n${memoryContext}\n</relevant-memories>`,
            );
          }
          if (experienceContext) {
            contexts.push(
              `<relevant-experiences>\nThe following experiences may be relevant to this conversation:\n${experienceContext}\n</relevant-experiences>`,
            );
          }

          if (memoryResults.length > 0 || experienceResults.length > 0) {
            api.logger.info(
              `memory-powermem: injecting ${memoryResults.length} memories and ${experienceResults.length} experiences into context`,
            );
          }

          return {
            prependSystemContext: MEMORY_RECALL_GUIDANCE,
            ...(contexts.length > 0 ? { prependContext: contexts.join("\n\n") } : {}),
          };
        } catch (err) {
          api.logger.warn(`memory-powermem: recall failed: ${String(err)}`);
          return { prependSystemContext: MEMORY_RECALL_GUIDANCE };
        }
      });
    }

    if (cfg.walCapture) {
      api.on("before_agent_start", async (...args: unknown[]) => {
        const [event, ctx] = args as [unknown, ToolContext & { sessionKey?: string }];
        const e = event as { prompt?: string; messages?: unknown[] };
        const prompt =
          typeof e.prompt === "string" && e.prompt.trim().length >= 5
            ? e.prompt.trim()
            : lastUserMessageText(e.messages);
        if (!prompt) return;
        const sessionKey = ctx?.sessionKey ?? "fallback";
        walCapture(prompt, sessionKey, ctx?.agentId).catch((err) => {
          api.logger.warn(`memory-powermem: wal capture failed: ${String(err)}`);
        });
      });
    }

    if (cfg.autoCapture) {
      api.on("agent_end", (...args: unknown[]) => {
        const [event, ctx] = args as [unknown, ToolContext];
        const e = event as { messages: unknown[]; success: boolean; error?: string };
        if (!e.success || !e.messages || e.messages.length === 0) {
          return;
        }
        const messages = e.messages;
        const agentId = ctx?.agentId;

        void (async () => {
          try {
            const agentClient = getClientForAgent(agentId);
            const texts: string[] = [];
            for (const msg of messages) {
              if (!msg || typeof msg !== "object") continue;
              const msgObj = msg as Record<string, unknown>;
              const role = msgObj.role;
              if (role !== "user" && role !== "assistant") continue;
              const content = msgObj.content;
              if (typeof content === "string") {
                texts.push(content);
                continue;
              }
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (
                    block &&
                    typeof block === "object" &&
                    "type" in block &&
                    (block as Record<string, unknown>).type === "text" &&
                    "text" in block &&
                    typeof (block as Record<string, unknown>).text === "string"
                  ) {
                    texts.push((block as Record<string, unknown>).text as string);
                  }
                }
              }
            }

            const MIN_LEN = 10;
            const MAX_CHUNK_LEN = 6000;
            const MAX_CHUNKS_PER_SESSION = 3;
            const sanitized = texts
              .filter((t): t is string => typeof t === "string" && t.trim().length >= MIN_LEN)
              .map((t) => t.trim())
              .filter(
                (t) =>
                  !t.includes("<relevant-memories>") &&
                  !(t.startsWith("<") && t.includes("</")),
              );
            if (sanitized.length === 0) return;

            const combined = sanitized.join("\n\n");
            const chunks: string[] = [];
            for (let i = 0; i < combined.length; i += MAX_CHUNK_LEN) {
              if (chunks.length >= MAX_CHUNKS_PER_SESSION) break;
              chunks.push(combined.slice(i, i + MAX_CHUNK_LEN));
            }

            let stored = 0;
            for (const chunk of chunks) {
              const created = await agentClient.add(chunk, { infer: cfg.inferOnAdd });
              stored += created.length;
            }
            if (stored > 0) {
              api.logger.info(
                `memory-powermem: auto-captured ${stored} memories from conversation`,
              );
            }
          } catch (err) {
            api.logger.warn(`memory-powermem: capture failed: ${String(err)}`);
          }
        })();
      });
    }

    if (cfg.autoExperience) {
      api.on("agent_end", (...args: unknown[]) => {
        const [event, ctx] = args as [unknown, ToolContext];
        const e = event as { messages: unknown[]; success: boolean; error?: string };
        if (!e.success || !e.messages || e.messages.length === 0) {
          return;
        }
        const messages = e.messages;
        const agentId = ctx?.agentId;

        void (async () => {
          try {
            const agentClient = getClientForAgent(agentId);
            const tools = extractToolNames(messages);
            const experiences = await extractExperiencesWithLlm(messages);
            if (experiences.length === 0) return;
            for (const exp of experiences) {
              await agentClient.add(exp, {
                infer: false,
                metadata: {
                  type: "experience",
                  source: "auto",
                  tools,
                },
              });
            }
            api.logger.info(`memory-powermem: auto-experience stored (${experiences.length})`);
          } catch (err) {
            api.logger.warn(`memory-powermem: auto-experience failed: ${String(err)}`);
          }
        })();
      });
    }

    if (cfg.walCapture) {
      api.on("session_end", (...args: unknown[]) => {
        const [, ctx] = args as [unknown, ToolContext & { sessionKey?: string }];
        const key = ctx?.sessionKey ?? "fallback";
        walSession.clear(key);
      });
    }

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "memory-powermem",
      start: async (_ctx: OpenClawPluginServiceContext) => {
        try {
          const h = await client.health();
          const where =
            cfg.mode === "cli"
              ? `cli ${resolvePmemExecutable(cfg.pmemPath ?? DEFAULT_PMEM_PATH)}`
              : cfg.baseUrl;
          const detail =
            h.status !== "healthy" && "error" in h && h.error ? `: ${h.error}` : "";
          api.logger.info(
            `memory-powermem: initialized (${where}, health: ${h.status}${detail})`,
          );
        } catch (err) {
          const hint =
            cfg.mode === "cli"
              ? "is npm powermem installed (plugin dependencies)? Or set pmemPath to auto / a Python venv pmem. Check agents.defaults.model + keys, or envFile."
              : "is PowerMem server running?";
          api.logger.warn(
            `memory-powermem: health check failed (${hint}): ${String(err)}`,
          );
        }
      },
      stop: (_ctx: OpenClawPluginServiceContext) => {
        api.logger.info("memory-powermem: stopped");
      },
    });
  },
};

export default memoryPlugin;
