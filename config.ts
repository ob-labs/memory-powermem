/**
 * PowerMem memory plugin configuration.
 * Validates baseUrl, optional apiKey, and user/agent mapping.
 */

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return;
  throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const envValue = process.env[envVar];
    if (!envValue) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}

export type PowerMemMode = "http" | "cli";

export type PowerMemConfig = {
  mode: PowerMemMode;
  baseUrl: string;
  apiKey?: string;
  /** CLI mode: path to .env (optional; pmem discovers if omitted). */
  envFile?: string;
  /** CLI mode: path to pmem binary (default "pmem"). */
  pmemPath?: string;
  userId?: string;
  agentId?: string;
  /** Max memories to return in recall / inject in auto-recall. Default 5. */
  recallLimit?: number;
  /** Min score (0–1) for recall; memories below are filtered. Default 0. */
  recallScoreThreshold?: number;
  autoCapture: boolean;
  autoRecall: boolean;
  inferOnAdd: boolean;
};

const DEFAULT_RECALL_LIMIT = 5;
const DEFAULT_RECALL_SCORE_THRESHOLD = 0;

const ALLOWED_KEYS = [
  "mode",
  "baseUrl",
  "apiKey",
  "envFile",
  "pmemPath",
  "userId",
  "agentId",
  "recallLimit",
  "recallScoreThreshold",
  "autoCapture",
  "autoRecall",
  "inferOnAdd",
] as const;

export const powerMemConfigSchema = {
  parse(value: unknown): PowerMemConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("memory-powermem config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(cfg, [...ALLOWED_KEYS], "memory-powermem config");

    const mode =
      (cfg.mode === "cli" || cfg.mode === "http" ? cfg.mode : undefined) ?? "http";

    let baseUrl = "";
    let apiKey: string | undefined;
    if (mode === "http") {
      const baseUrlRaw = cfg.baseUrl;
      if (typeof baseUrlRaw !== "string" || !baseUrlRaw.trim()) {
        throw new Error("memory-powermem baseUrl is required when mode is http");
      }
      baseUrl = resolveEnvVars(baseUrlRaw.trim()).replace(/\/+$/, "");
      const apiKeyRaw = cfg.apiKey;
      apiKey =
        typeof apiKeyRaw === "string" && apiKeyRaw.trim()
          ? resolveEnvVars(apiKeyRaw.trim())
          : undefined;
    }

    const envFileRaw = cfg.envFile;
    const envFile =
      typeof envFileRaw === "string" && envFileRaw.trim()
        ? envFileRaw.trim()
        : undefined;

    const pmemPathRaw = cfg.pmemPath;
    const pmemPath =
      typeof pmemPathRaw === "string" && pmemPathRaw.trim()
        ? pmemPathRaw.trim()
        : "pmem";

    return {
      mode,
      baseUrl,
      apiKey,
      envFile,
      pmemPath,
      userId:
        typeof cfg.userId === "string" && cfg.userId.trim()
          ? cfg.userId.trim()
          : undefined,
      agentId:
        typeof cfg.agentId === "string" && cfg.agentId.trim()
          ? cfg.agentId.trim()
          : undefined,
      recallLimit: toRecallLimit(cfg.recallLimit),
      recallScoreThreshold: toRecallScoreThreshold(cfg.recallScoreThreshold),
      autoCapture: cfg.autoCapture !== false,
      autoRecall: cfg.autoRecall !== false,
      inferOnAdd: cfg.inferOnAdd !== false,
    };
  },
};

function toRecallLimit(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v >= 1) {
    return Math.min(100, Math.floor(v));
  }
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = parseInt(v, 10);
    return n >= 1 ? Math.min(100, n) : DEFAULT_RECALL_LIMIT;
  }
  return DEFAULT_RECALL_LIMIT;
}

function toRecallScoreThreshold(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(0, Math.min(1, v));
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
  }
  return DEFAULT_RECALL_SCORE_THRESHOLD;
}

/** Default user/agent IDs when not configured (single-tenant style). */
export const DEFAULT_USER_ID = "openclaw-user";
export const DEFAULT_AGENT_ID = "openclaw-agent";

/**
 * Default plugin config when openclaw.json has no plugins.entries["memory-powermem"].config.
 * Allows "openclaw plugins install openclaw-extension-powermem" to work without manual config.
 */
export const DEFAULT_PLUGIN_CONFIG: PowerMemConfig = {
  mode: "http",
  baseUrl: "http://localhost:8000",
  autoCapture: true,
  autoRecall: true,
  inferOnAdd: true,
};

export function resolveUserId(cfg: PowerMemConfig): string {
  return cfg.userId ?? DEFAULT_USER_ID;
}

export function resolveAgentId(cfg: PowerMemConfig): string {
  return cfg.agentId ?? DEFAULT_AGENT_ID;
}
