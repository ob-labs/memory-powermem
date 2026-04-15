/**
 * Build PowerMem process env from OpenClaw gateway config + model auth.
 * Used when no powermem .env exists (or to override LLM keys on top of a file).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type ResolveProviderAuth = (provider: string) => Promise<{ apiKey?: string }>;

export type BuildPowermemCliEnvOptions = {
  openclawConfig: unknown;
  stateDir: string;
  resolveProviderAuth: ResolveProviderAuth;
  warn?: (msg: string) => void;
};

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

function getPrimaryModelRef(config: unknown): { provider: string; model: string } | undefined {
  const c = asRecord(config);
  const agents = asRecord(c?.agents);
  const defaults = asRecord(agents?.defaults);
  const model = defaults?.model;
  if (typeof model === "string" && model.includes("/")) {
    const i = model.indexOf("/");
    return { provider: model.slice(0, i), model: model.slice(i + 1) };
  }
  if (model && typeof model === "object") {
    const m = model as Record<string, unknown>;
    const primary = m.primary;
    if (typeof primary === "string" && primary.includes("/")) {
      const i = primary.indexOf("/");
      return { provider: primary.slice(0, i), model: primary.slice(i + 1) };
    }
  }
  return undefined;
}

function getProviderEntry(
  config: unknown,
  providerId: string,
): Record<string, unknown> | undefined {
  const c = asRecord(config);
  const models = asRecord(c?.models);
  const providers = asRecord(models?.providers);
  if (!providers) return undefined;
  const raw = providers[providerId];
  return asRecord(raw);
}

function secretToString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

/**
 * DashScope native HTTP API base (Generation / TextEmbedding SDK).
 * OpenClaw "bailian" often uses OpenAI-compatible `/compatible-mode/v1`, which must not be used for PowerMem's qwen embedder.
 */
function dashscopeNativeBaseUrl(openclawBaseUrl: string | undefined): string | undefined {
  if (!openclawBaseUrl?.trim()) return undefined;
  const u = openclawBaseUrl.trim().replace(/\/+$/, "");
  if (u.includes("/compatible-mode/")) {
    return u.replace(/\/compatible-mode\/v1$/i, "/api/v1");
  }
  return u;
}

/** Map OpenClaw catalog provider id → PowerMem LLM provider name where they differ. */
function normalizePowermemProvider(openclawProvider: string): string {
  const p = openclawProvider.toLowerCase();
  if (p === "google" || p === "google-generative-ai") return "gemini";
  if (p === "dashscope" || p === "bailian") return "qwen";
  return p;
}

async function resolveKey(
  openclawProvider: string,
  providerCfg: Record<string, unknown> | undefined,
  resolveProviderAuth: ResolveProviderAuth,
): Promise<string | undefined> {
  try {
    const auth = await resolveProviderAuth(openclawProvider);
    if (auth.apiKey?.trim()) return auth.apiKey.trim();
  } catch {
    /* fall through */
  }
  return secretToString(providerCfg?.apiKey);
}

/** SQLite layout under OpenClaw state dir (no .env file required). */
export function buildDefaultSqlitePowermemEnv(stateDir: string): Record<string, string> {
  const dataDir = join(stateDir, "powermem", "data");
  try {
    mkdirSync(dataDir, { recursive: true });
  } catch {
    /* best effort */
  }
  return {
    TIMEZONE: process.env.TIMEZONE || "UTC",
    DATABASE_PROVIDER: "sqlite",
    SQLITE_PATH: join(dataDir, "powermem.db"),
    SQLITE_ENABLE_WAL: "true",
    SQLITE_COLLECTION: "memories",
  };
}

async function embeddingOpenaiFallback(
  resolveProviderAuth: ResolveProviderAuth,
  warn?: (msg: string) => void,
): Promise<Record<string, string>> {
  const k = await resolveKey("openai", undefined, resolveProviderAuth).catch(() => undefined);
  if (k) {
    return {
      EMBEDDING_PROVIDER: "openai",
      EMBEDDING_API_KEY: k,
      EMBEDDING_MODEL: "text-embedding-3-small",
      EMBEDDING_DIMS: "1536",
    };
  }
  warn?.(
    "memory-powermem: no OpenAI API key for embeddings; using local Ollama defaults (nomic-embed-text). Install Ollama or add openai provider keys.",
  );
  return {
    EMBEDDING_PROVIDER: "ollama",
    EMBEDDING_MODEL: "nomic-embed-text",
    EMBEDDING_DIMS: "768",
    OLLAMA_EMBEDDING_BASE_URL: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
  };
}

/**
 * Async env vars to merge into the `pmem` subprocess (after process.env).
 * Always includes SQLite under stateDir. Adds LLM/embedding from OpenClaw when a primary model is set.
 */
export async function buildPowermemCliProcessEnv(
  opts: BuildPowermemCliEnvOptions,
): Promise<Record<string, string>> {
  const out: Record<string, string> = { ...buildDefaultSqlitePowermemEnv(opts.stateDir) };
  const ref = getPrimaryModelRef(opts.openclawConfig);
  if (!ref) {
    opts.warn?.(
      "memory-powermem: OpenClaw agents.defaults.model not set; PowerMem needs LLM env. Configure a model in openclaw.json or use a powermem .env file.",
    );
    return out;
  }

  const { provider: ocProvider, model } = ref;
  const pmProvider = normalizePowermemProvider(ocProvider);
  const pCfg = getProviderEntry(opts.openclawConfig, ocProvider);
  const baseUrl = typeof pCfg?.baseUrl === "string" ? pCfg.baseUrl.trim() : undefined;
  const apiKey = await resolveKey(ocProvider, pCfg, opts.resolveProviderAuth);

  if (!apiKey && pmProvider !== "ollama") {
    opts.warn?.(
      `memory-powermem: could not resolve API key for provider "${ocProvider}"; set keys in OpenClaw or use a powermem .env file.`,
    );
  }

  switch (pmProvider) {
    case "openai": {
      out.LLM_PROVIDER = "openai";
      if (apiKey) out.LLM_API_KEY = apiKey;
      out.LLM_MODEL = model;
      if (baseUrl) out.OPENAI_LLM_BASE_URL = baseUrl;
      out.EMBEDDING_PROVIDER = "openai";
      if (apiKey) out.EMBEDDING_API_KEY = apiKey;
      out.EMBEDDING_MODEL = "text-embedding-3-small";
      out.EMBEDDING_DIMS = "1536";
      if (baseUrl) out.OPENAI_EMBEDDING_BASE_URL = baseUrl;
      break;
    }
    case "groq": {
      out.LLM_PROVIDER = "openai";
      if (apiKey) out.LLM_API_KEY = apiKey;
      out.LLM_MODEL = model;
      out.OPENAI_LLM_BASE_URL = baseUrl || "https://api.groq.com/openai/v1";
      Object.assign(out, await embeddingOpenaiFallback(opts.resolveProviderAuth, opts.warn));
      break;
    }
    case "openrouter": {
      out.LLM_PROVIDER = "openai";
      if (apiKey) out.LLM_API_KEY = apiKey;
      out.LLM_MODEL = model;
      out.OPENAI_LLM_BASE_URL = baseUrl || "https://openrouter.ai/api/v1";
      Object.assign(out, await embeddingOpenaiFallback(opts.resolveProviderAuth, opts.warn));
      break;
    }
    case "anthropic": {
      out.LLM_PROVIDER = "anthropic";
      if (apiKey) out.LLM_API_KEY = apiKey;
      out.LLM_MODEL = model;
      if (baseUrl) out.ANTHROPIC_LLM_BASE_URL = baseUrl;
      Object.assign(out, await embeddingOpenaiFallback(opts.resolveProviderAuth, opts.warn));
      break;
    }
    case "qwen": {
      out.LLM_PROVIDER = "qwen";
      if (apiKey) out.LLM_API_KEY = apiKey;
      out.LLM_MODEL = model;
      out.EMBEDDING_PROVIDER = "qwen";
      if (apiKey) out.EMBEDDING_API_KEY = apiKey;
      out.EMBEDDING_MODEL = "text-embedding-v4";
      out.EMBEDDING_DIMS = "1536";
      {
        const native = dashscopeNativeBaseUrl(baseUrl);
        if (native) out.DASHSCOPE_BASE_URL = native;
      }
      break;
    }
    case "ollama": {
      out.LLM_PROVIDER = "ollama";
      out.LLM_MODEL = model;
      out.OLLAMA_LLM_BASE_URL = baseUrl || "http://127.0.0.1:11434";
      out.EMBEDDING_PROVIDER = "ollama";
      out.EMBEDDING_MODEL = "nomic-embed-text";
      out.EMBEDDING_DIMS = "768";
      out.OLLAMA_EMBEDDING_BASE_URL = baseUrl || "http://127.0.0.1:11434";
      break;
    }
    case "deepseek": {
      out.LLM_PROVIDER = "deepseek";
      if (apiKey) out.LLM_API_KEY = apiKey;
      out.LLM_MODEL = model;
      if (baseUrl) out.DEEPSEEK_LLM_BASE_URL = baseUrl;
      Object.assign(out, await embeddingOpenaiFallback(opts.resolveProviderAuth, opts.warn));
      break;
    }
    case "gemini": {
      out.LLM_PROVIDER = "gemini";
      if (apiKey) out.LLM_API_KEY = apiKey;
      out.LLM_MODEL = model;
      out.EMBEDDING_PROVIDER = "gemini";
      if (apiKey) out.EMBEDDING_API_KEY = apiKey;
      out.EMBEDDING_MODEL = "text-embedding-004";
      out.EMBEDDING_DIMS = "768";
      break;
    }
    case "siliconflow": {
      out.LLM_PROVIDER = "siliconflow";
      if (apiKey) out.LLM_API_KEY = apiKey;
      out.LLM_MODEL = model;
      out.EMBEDDING_PROVIDER = "siliconflow";
      if (apiKey) out.EMBEDDING_API_KEY = apiKey;
      out.EMBEDDING_MODEL = "BAAI/bge-m3";
      out.EMBEDDING_DIMS = "1024";
      if (baseUrl) out.SILICONFLOW_EMBEDDING_BASE_URL = baseUrl;
      break;
    }
    default: {
      /* OpenAI-compatible custom providers */
      if (baseUrl && apiKey) {
        out.LLM_PROVIDER = "openai";
        out.LLM_API_KEY = apiKey;
        out.LLM_MODEL = model;
        out.OPENAI_LLM_BASE_URL = baseUrl;
        out.EMBEDDING_PROVIDER = "openai";
        out.EMBEDDING_API_KEY = apiKey;
        out.EMBEDDING_MODEL = "text-embedding-3-small";
        out.EMBEDDING_DIMS = "1536";
        out.OPENAI_EMBEDDING_BASE_URL = baseUrl;
        opts.warn?.(
          `memory-powermem: treating provider "${ocProvider}" as OpenAI-compatible (custom baseUrl).`,
        );
        break;
      }
      opts.warn?.(
        `memory-powermem: unsupported OpenClaw provider "${ocProvider}" for auto PowerMem env; add a powermem .env or open a feature request.`,
      );
    }
  }

  return out;
}
