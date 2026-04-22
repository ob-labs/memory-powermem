/**
 * PowerMem memory plugin configuration.
 * Validates baseUrl, optional apiKey, and user/agent mapping.
 */

import { homedir } from "node:os";
import { join } from "node:path";

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
export type PowerMemHttpApiVersion = "v1" | "v2";

export type PowerMemConfig = {
  mode: PowerMemMode;
  baseUrl: string;
  apiKey?: string;
  httpApiVersion?: PowerMemHttpApiVersion;
  requestTimeoutMs?: number;
  requestConfig?: Record<string, unknown>;
  /** CLI mode: path to .env (optional; pmem discovers if omitted). */
  envFile?: string;
  /**
   * CLI: how to run `pmem`.
   * - `bundled` (default): prefer npm `powermem` next to this plugin; else `pmem` on PATH (e.g. Python).
   * - `auto`: same resolution as `bundled`.
   * - any other string: command name or absolute path to a `pmem` binary.
   */
  pmemPath?: string;
  /**
   * When true (default), inject LLM/embedding from OpenClaw gateway config into `pmem`
   * (overrides the same keys from an optional .env file). SQLite defaults live under the OpenClaw state dir.
   */
  useOpenClawModel?: boolean;
  userId?: string;
  agentId?: string;
  /** Max memories to return in recall / inject in auto-recall. Default 5. */
  recallLimit?: number;
  /** Min score (0–1) for recall; memories below are filtered. Default 0. */
  recallScoreThreshold?: number;
  /** Incremental write-ahead capture during conversations. */
  walCapture: boolean;
  autoCapture: boolean;
  autoRecall: boolean;
  autoExperience: boolean;
  experienceRecall: boolean;
  inferOnAdd: boolean;
  debugPerfLog?: boolean;
  perfSlowMs?: number;
  dualWrite?: boolean;
  localDbPath?: string;
  localUserId?: string;
  localAgentId?: string;
  syncOnResume?: boolean;
  syncBatchSize?: number;
  syncMinIntervalMs?: number;
  syncBaseDelayMs?: number;
  syncMaxDelayMs?: number;
  syncMaxRetries?: number;
  localVector?: {
    enabled?: boolean;
    provider?: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    headers?: Record<string, string>;
    extensionPath?: string;
  };
};

const DEFAULT_RECALL_LIMIT = 5;
const DEFAULT_RECALL_SCORE_THRESHOLD = 0;

const ALLOWED_KEYS = [
  "mode",
  "baseUrl",
  "apiKey",
  "httpApiVersion",
  "requestTimeoutMs",
  "requestConfig",
  "envFile",
  "pmemPath",
  "useOpenClawModel",
  "userId",
  "agentId",
  "recallLimit",
  "recallScoreThreshold",
  "walCapture",
  "autoCapture",
  "autoRecall",
  "autoExperience",
  "experienceRecall",
  "inferOnAdd",
  "debugPerfLog",
  "perfSlowMs",
  "dualWrite",
  "localDbPath",
  "localUserId",
  "localAgentId",
  "syncOnResume",
  "syncBatchSize",
  "syncMinIntervalMs",
  "syncBaseDelayMs",
  "syncMaxDelayMs",
  "syncMaxRetries",
  "localVector",
] as const;

/** CLI `pmemPath` when omitted; npm `powermem` bundled with this plugin. */
export const DEFAULT_PMEM_PATH = "bundled";

export const powerMemConfigSchema = {
  parse(value: unknown): PowerMemConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("memory-powermem config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(cfg, [...ALLOWED_KEYS], "memory-powermem config");

    const modeExplicit =
      cfg.mode === "cli" || cfg.mode === "http" ? cfg.mode : undefined;
    const baseUrlForInfer =
      typeof cfg.baseUrl === "string" ? cfg.baseUrl.trim() : "";
    const mode =
      modeExplicit ?? (baseUrlForInfer ? "http" : "cli");

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
        : DEFAULT_PMEM_PATH;

    const httpApiVersion =
      cfg.httpApiVersion === "v2" ? "v2" : "v1";

  const requestTimeoutMs = toPositiveInt(cfg.requestTimeoutMs, 30000, 0, 300000);
    const requestConfig =
      cfg.requestConfig && typeof cfg.requestConfig === "object" && !Array.isArray(cfg.requestConfig)
        ? cfg.requestConfig as Record<string, unknown>
        : undefined;

    const localDbPathRaw = cfg.localDbPath;
    const localDbPath =
      typeof localDbPathRaw === "string" && localDbPathRaw.trim()
        ? resolveEnvVars(localDbPathRaw.trim())
        : undefined;
    const localVectorRaw = cfg.localVector;
    const localVectorCandidate =
      localVectorRaw && typeof localVectorRaw === "object" && !Array.isArray(localVectorRaw)
        ? (localVectorRaw as Record<string, unknown>)
        : undefined;
    const localVector =
      localVectorCandidate
        ? pruneUndefined({
            enabled:
              typeof localVectorCandidate.enabled === "boolean"
                ? localVectorCandidate.enabled
                : undefined,
            provider:
              typeof localVectorCandidate.provider === "string" &&
              localVectorCandidate.provider.trim()
                ? localVectorCandidate.provider.trim()
                : undefined,
            model:
              typeof localVectorCandidate.model === "string" && localVectorCandidate.model.trim()
                ? localVectorCandidate.model.trim()
                : undefined,
            apiKey:
              typeof localVectorCandidate.apiKey === "string" && localVectorCandidate.apiKey.trim()
                ? resolveEnvVars(localVectorCandidate.apiKey.trim())
                : undefined,
            baseUrl:
              typeof localVectorCandidate.baseUrl === "string" &&
              localVectorCandidate.baseUrl.trim()
                ? resolveEnvVars(localVectorCandidate.baseUrl.trim()).replace(/\/+$/, "")
                : undefined,
            headers: parseHeaderMap(localVectorCandidate.headers),
            extensionPath:
              typeof localVectorCandidate.extensionPath === "string" &&
              localVectorCandidate.extensionPath.trim()
                ? resolveEnvVars(localVectorCandidate.extensionPath.trim())
                : undefined,
          })
        : undefined;

    const syncBatchSize = toPositiveInt(cfg.syncBatchSize, 50, 1, 500);
    const syncMinIntervalMs = toPositiveInt(cfg.syncMinIntervalMs, 5000, 1000, 600000);
    const syncBaseDelayMs = toPositiveInt(cfg.syncBaseDelayMs, 5000, 1000, 600000);
    const syncMaxDelayMs = toPositiveInt(cfg.syncMaxDelayMs, 60000, 1000, 3600000);
    const syncMaxRetries = toPositiveInt(cfg.syncMaxRetries, 10, 0, 100);

    return {
      mode,
      baseUrl,
      apiKey,
      httpApiVersion,
      requestTimeoutMs,
      requestConfig,
      envFile,
      pmemPath,
      useOpenClawModel: cfg.useOpenClawModel !== false,
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
      walCapture: cfg.walCapture !== false,
      autoCapture: cfg.autoCapture !== false,
      autoRecall: cfg.autoRecall !== false,
      autoExperience: cfg.autoExperience !== false,
      experienceRecall: cfg.experienceRecall !== false,
      inferOnAdd: cfg.inferOnAdd !== false,
      debugPerfLog: cfg.debugPerfLog === true,
      perfSlowMs: toPositiveInt(cfg.perfSlowMs, 800, 1, 600000),
      dualWrite: cfg.dualWrite === true,
      localDbPath,
      localUserId:
        typeof cfg.localUserId === "string" && cfg.localUserId.trim()
          ? cfg.localUserId.trim()
          : undefined,
      localAgentId:
        typeof cfg.localAgentId === "string" && cfg.localAgentId.trim()
          ? cfg.localAgentId.trim()
          : undefined,
      syncOnResume: cfg.syncOnResume !== false,
      syncBatchSize,
      syncMinIntervalMs,
      syncBaseDelayMs,
      syncMaxDelayMs,
      syncMaxRetries,
      localVector,
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

function toPositiveInt(
  v: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    const n = Math.floor(v);
    return Math.min(max, Math.max(min, n));
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) {
      return Math.min(max, Math.max(min, Math.floor(n)));
    }
  }
  return fallback;
}

function parseHeaderMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter(([, v]) => typeof v === "string");
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(
    entries.map(([key, val]) => [key, resolveEnvVars(String(val))]),
  ) as Record<string, string>;
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries) as T;
}

/** Default user/agent IDs when not configured (single-tenant style). */
export const DEFAULT_USER_ID = "openclaw-user";
export const DEFAULT_AGENT_ID = "openclaw-agent";

/** Canonical PowerMem `.env` path for consumer (CLI) setups; matches install.sh. */
export function defaultConsumerPowermemEnvPath(): string {
  return join(homedir(), ".openclaw", "powermem", "powermem.env");
}

/**
 * Default plugin config when openclaw.json has no plugins.entries["memory-powermem"].config.
 * Consumer default: CLI, no .env required — SQLite under OpenClaw state dir + LLM from OpenClaw `agents.defaults.model`.
 * Optional: set `envFile` to merge a powermem .env under OpenClaw-derived vars.
 * Enterprise / shared server: set `mode: "http"` and `baseUrl`.
 */
export const DEFAULT_PLUGIN_CONFIG: PowerMemConfig = {
  mode: "cli",
  baseUrl: "",
  httpApiVersion: "v1",
  requestTimeoutMs: 30000,
  requestConfig: undefined,
  envFile: undefined,
  pmemPath: DEFAULT_PMEM_PATH,
  useOpenClawModel: true,
  walCapture: true,
  autoCapture: true,
  autoRecall: true,
  autoExperience: true,
  experienceRecall: true,
  inferOnAdd: true,
  debugPerfLog: false,
  perfSlowMs: 800,
  dualWrite: false,
  localDbPath: undefined,
  localUserId: undefined,
  localAgentId: undefined,
  syncOnResume: true,
  syncBatchSize: 50,
  syncMinIntervalMs: 5000,
  syncBaseDelayMs: 5000,
  syncMaxDelayMs: 60000,
  syncMaxRetries: 10,
  localVector: undefined,
};

export function resolveUserId(cfg: PowerMemConfig): string {
  return cfg.userId ?? DEFAULT_USER_ID;
}

export function resolveAgentId(cfg: PowerMemConfig): string {
  return cfg.agentId ?? DEFAULT_AGENT_ID;
}
