/**
 * OpenClaw Memory (PowerMem) Plugin
 *
 * Long-term memory via PowerMem: intelligent extraction, Ebbinghaus
 * forgetting curve, multi-agent isolation. Supports two backends:
 * - HTTP: requires a running PowerMem server (e.g. powermem-server --port 8000).
 * - CLI: runs pmem locally (no server); set mode to "cli" and optionally envFile/pmemPath.
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
  resolveUserId,
  resolveAgentId,
  type PowerMemConfig,
} from "./config.js";
import { PowerMemClient } from "./client.js";
import { PowerMemCLIClient } from "./client-cli.js";

// ============================================================================
// Plugin Definition
// ============================================================================

const memoryPlugin = {
  id: "memory-powermem",
  name: "Memory (PowerMem)",
  description:
    "PowerMem-backed long-term memory (intelligent extraction, forgetting curve). Backend: HTTP server or local CLI (pmem).",
  kind: "memory" as const,
  configSchema: powerMemConfigSchema,

  register(api: OpenClawPluginApi) {
    const raw = api.pluginConfig;
    const toParse =
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      Object.keys(raw).length > 0
        ? { ...DEFAULT_PLUGIN_CONFIG, ...raw }
        : DEFAULT_PLUGIN_CONFIG;
    const cfg = powerMemConfigSchema.parse(toParse) as PowerMemConfig;
    const userId = resolveUserId(cfg);
    const agentId = resolveAgentId(cfg);
    const client =
      cfg.mode === "cli"
        ? PowerMemCLIClient.fromConfig(cfg, userId, agentId)
        : PowerMemClient.fromConfig(cfg, userId, agentId);
    const modeLabel = cfg.mode === "cli" ? `cli (${cfg.pmemPath ?? "pmem"})` : cfg.baseUrl;

    api.logger.info(
      `memory-powermem: plugin registered (mode: ${cfg.mode}, ${modeLabel}, user: ${userId}, agent: ${agentId})`,
    );

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
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
            const raw = await client.search(query, requestLimit);
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
      },
      { name: "memory_recall" },
    );

    api.registerTool(
      {
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
          const { text, importance = 0.7 } = params as {
            text: string;
            importance?: number;
          };

          try {
            const created = await client.add(text, {
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
      },
      { name: "memory_store" },
    );

    api.registerTool(
      {
        name: "memory_forget",
        label: "Memory Forget",
        description: "Delete specific memories. GDPR-compliant.",
        parameters: Type.Object({
          query: Type.Optional(Type.String({ description: "Search to find memory" })),
          memoryId: Type.Optional(Type.String({ description: "Specific memory ID" })),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const { query, memoryId } = params as { query?: string; memoryId?: string };

          try {
            if (memoryId) {
              await client.delete(memoryId);
              return {
                content: [{ type: "text", text: `Memory ${memoryId} forgotten.` }],
                details: { action: "deleted", id: memoryId },
              };
            }

            if (query) {
              const results = await client.search(query, 5);
              if (results.length === 0) {
                return {
                  content: [{ type: "text", text: "No matching memories found." }],
                  details: { found: 0 },
                };
              }
              if (results.length === 1 && (results[0].score ?? 0) > 0.9) {
                await client.delete(results[0].memory_id);
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
      },
      { name: "memory_forget" },
    );

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
          .action(async (...args: unknown[]) => {
            const query = String(args[0] ?? "");
            const opts = (args[1] ?? {}) as { limit?: string };
            const limit = parseInt(opts.limit ?? "5", 10);
            const results = await client.search(query, limit);
            console.log(JSON.stringify(results, null, 2));
          });

        ltm
          .command("health")
          .description("Check PowerMem server health")
          .action(async () => {
            try {
              const h = await client.health();
              console.log("PowerMem:", h.status);
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
      "When answering about past events, user preferences, people, or anything the user may have told you before: use the memory_recall tool to search long-term memory first, or use any <relevant-memories> already injected in this turn.\n";

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

    if (cfg.autoRecall) {
      api.on("before_agent_start", async (event: unknown) => {
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
          const raw = await client.search(query, requestLimit);
          const results = raw
            .filter((r) => (r.score ?? 0) >= scoreThreshold)
            .slice(0, recallLimit);

          const memoryContext =
            results.length > 0
              ? results.map((r) => `- ${r.content}`).join("\n")
              : "";
          if (results.length > 0) {
            api.logger.info(
              `memory-powermem: injecting ${results.length} memories into context`,
            );
          }
          return {
            prependSystemContext: MEMORY_RECALL_GUIDANCE,
            ...(memoryContext
              ? {
                  prependContext: `<relevant-memories>\nThe following memories may be relevant to this conversation:\n${memoryContext}\n</relevant-memories>`,
                }
              : {}),
          };
        } catch (err) {
          api.logger.warn(`memory-powermem: recall failed: ${String(err)}`);
          return { prependSystemContext: MEMORY_RECALL_GUIDANCE };
        }
      });
    }

    if (cfg.autoCapture) {
      api.on("agent_end", async (event: unknown) => {
        const e = event as { messages: unknown[]; success: boolean; error?: string };
        if (!e.success || !e.messages || e.messages.length === 0) {
          return;
        }

        try {
          const texts: string[] = [];
          for (const msg of e.messages) {
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
            const created = await client.add(chunk, { infer: cfg.inferOnAdd });
            stored += created.length;
          }
          if (stored > 0) {
            api.logger.info(`memory-powermem: auto-captured ${stored} memories from conversation`);
          }
        } catch (err) {
          api.logger.warn(`memory-powermem: capture failed: ${String(err)}`);
        }
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
          const where = cfg.mode === "cli" ? `cli ${cfg.pmemPath ?? "pmem"}` : cfg.baseUrl;
          api.logger.info(
            `memory-powermem: initialized (${where}, health: ${h.status})`,
          );
        } catch (err) {
          const hint =
            cfg.mode === "cli"
              ? "is pmem on PATH and POWERMEM_ENV_FILE or --env-file set?"
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
