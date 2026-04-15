import { getEnvApiKey } from "@mariozechner/pi-ai";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/memory-core";

import type { PowerMemConfig } from "./config.js";

type Logger = { info?: (msg: string) => void; warn?: (msg: string) => void };

export type LocalEmbeddingProvider = {
  id: string;
  model: string;
  embed: (text: string) => Promise<number[]>;
  embedBatch?: (texts: string[]) => Promise<number[][]>;
};

export type LocalEmbeddingConfig = {
  enabled: boolean;
  provider: string;
  providerKey?: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  extensionPath?: string;
};

export type LocalEmbeddingFactory = {
  config: LocalEmbeddingConfig;
  get: () => Promise<LocalEmbeddingProvider | null>;
};

const DEFAULT_OPENAI_MODEL = "text-embedding-3-small";
const DEFAULT_OLLAMA_MODEL = "nomic-embed-text";

const PROVIDER_ALIASES: Record<string, { provider: string; providerKey?: string }> = {
  bailian: { provider: "openai", providerKey: "bailian" },
  dashscope: { provider: "openai", providerKey: "dashscope" },
  qwen: { provider: "openai", providerKey: "qwen" },
};

function resolveProviderMapping(provider: string): { provider: string; providerKey: string } {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "auto") {
    return { provider: "openai", providerKey: "openai" };
  }
  const alias = PROVIDER_ALIASES[normalized];
  if (alias) {
    return { provider: alias.provider, providerKey: alias.providerKey ?? normalized };
  }
  return { provider: normalized, providerKey: normalized };
}

function resolveDefaultModel(provider: string): string {
  if (provider === "ollama") {
    return DEFAULT_OLLAMA_MODEL;
  }
  return DEFAULT_OPENAI_MODEL;
}

function normalizeBaseUrl(provider: string, baseUrl?: string): string | undefined {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    if (provider === "ollama") {
      return "http://localhost:11434/v1";
    }
    return "https://api.openai.com";
  }
  const cleaned = trimmed.replace(/\/+$/, "");
  if (provider === "ollama") {
    return cleaned.endsWith("/v1") ? cleaned : `${cleaned}/v1`;
  }
  return cleaned;
}

function buildEmbeddingsUrl(baseUrl: string): string {
  return baseUrl.endsWith("/v1") ? `${baseUrl}/embeddings` : `${baseUrl}/v1/embeddings`;
}

function normalizeEmbedding(vec: number[]): number[] {
  const sanitized = vec.map((value) => (Number.isFinite(value) ? value : 0));
  const magnitude = Math.sqrt(sanitized.reduce((sum, value) => sum + value * value, 0));
  if (magnitude < 1e-10) {
    return sanitized;
  }
  return sanitized.map((value) => value / magnitude);
}

function extractStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([, v]) => typeof v === "string");
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries as Array<[string, string]>);
}

function resolveMemorySearchConfig(
  openclawConfig: Record<string, unknown> | undefined,
  agentId: string,
): Record<string, unknown> | undefined {
  const agents =
    openclawConfig && typeof openclawConfig === "object"
      ? (openclawConfig as Record<string, unknown>).agents
      : undefined;
  const agentsRecord =
    agents && typeof agents === "object" ? (agents as Record<string, unknown>) : undefined;
  const list = Array.isArray(agentsRecord?.list) ? agentsRecord?.list : undefined;
  const matched = list?.find((entry: unknown) => {
    if (!entry || typeof entry !== "object") return false;
    const record = entry as Record<string, unknown>;
    return typeof record.id === "string" && record.id === agentId;
  });
  const agentMemorySearch =
    matched && typeof matched === "object"
      ? (matched as Record<string, unknown>).memorySearch
      : undefined;
  if (agentMemorySearch && typeof agentMemorySearch === "object") {
    return agentMemorySearch as Record<string, unknown>;
  }
  const defaultsMemorySearch =
    agentsRecord?.defaults && typeof agentsRecord.defaults === "object"
      ? (agentsRecord.defaults as Record<string, unknown>).memorySearch
      : undefined;
  if (defaultsMemorySearch && typeof defaultsMemorySearch === "object") {
    return defaultsMemorySearch as Record<string, unknown>;
  }
  return undefined;
}

function resolveLocalEmbeddingConfig(params: {
  api: OpenClawPluginApi;
  cfg: PowerMemConfig;
  agentId: string;
  logger: Logger;
}): LocalEmbeddingConfig | null {
  const localVector = params.cfg.localVector;
  const enabled = localVector?.enabled ?? params.cfg.dualWrite === true;
  if (!enabled) {
    return null;
  }

  const configRecord =
    params.api.config && typeof params.api.config === "object"
      ? (params.api.config as Record<string, unknown>)
      : undefined;
  const memorySearch = resolveMemorySearchConfig(configRecord, params.agentId);
  const memoryProviderRaw =
    typeof memorySearch?.provider === "string" ? memorySearch.provider : undefined;
  const resolvedProvider = resolveProviderMapping(
    localVector?.provider ?? memoryProviderRaw ?? "openai",
  );
  const provider = resolvedProvider.provider;
  const providerKey = resolvedProvider.providerKey;
  if (provider !== "openai" && provider !== "ollama") {
    params.logger.warn?.(
      `dual-write: local vector search supports openai/ollama providers only, got "${provider}"`,
    );
    return null;
  }

  const model =
    localVector?.model ??
    (typeof memorySearch?.model === "string" ? memorySearch.model : undefined) ??
    resolveDefaultModel(provider);
  if (!model) {
    params.logger.warn?.("dual-write: local vector search model is required");
    return null;
  }

  const memoryRemote =
    memorySearch?.remote && typeof memorySearch.remote === "object"
      ? (memorySearch.remote as Record<string, unknown>)
      : undefined;
  const memoryHeaders = extractStringMap(memoryRemote?.headers);
  const localHeaders = extractStringMap(localVector?.headers);
  const headers = localHeaders ?? memoryHeaders;

  const modelsRecord =
    configRecord?.models && typeof configRecord.models === "object"
      ? (configRecord.models as Record<string, unknown>)
      : undefined;
  const providersRecord =
    modelsRecord?.providers as Record<string, Record<string, unknown>> | undefined;
  const providerCfg = providersRecord?.[providerKey] ?? providersRecord?.[provider];
  const baseUrl = normalizeBaseUrl(
    provider,
    localVector?.baseUrl ??
      (typeof memoryRemote?.baseUrl === "string" ? memoryRemote.baseUrl : undefined) ??
      (typeof providerCfg?.baseUrl === "string" ? providerCfg.baseUrl : undefined),
  );

  const apiKey =
    localVector?.apiKey ??
    (typeof memoryRemote?.apiKey === "string" ? memoryRemote.apiKey : undefined) ??
    (typeof providerCfg?.apiKey === "string" ? providerCfg.apiKey : undefined);

  return {
    enabled: true,
    provider,
    providerKey,
    model,
    apiKey,
    baseUrl,
    headers,
    extensionPath: localVector?.extensionPath,
  };
}

async function resolveApiKey(
  api: OpenClawPluginApi,
  providerKey: string,
  provider: string,
  fallback?: string,
): Promise<string | undefined> {
  const candidates = Array.from(new Set([providerKey, provider].filter(Boolean)));
  try {
    const modelAuth = (api.runtime as { modelAuth?: { resolveApiKeyForProvider?: Function } } | undefined)
      ?.modelAuth;
    if (modelAuth?.resolveApiKeyForProvider) {
      for (const candidate of candidates) {
        const auth = await modelAuth.resolveApiKeyForProvider({ provider: candidate, cfg: api.config });
        if (auth?.apiKey) {
          return auth.apiKey;
        }
      }
    }
  } catch {
    // ignore
  }

  try {
    for (const candidate of candidates) {
      const envKey = getEnvApiKey(candidate);
      if (envKey) {
        return envKey;
      }
    }
  } catch {
    // ignore
  }

  return fallback;
}

async function createEmbeddingProvider(params: {
  api: OpenClawPluginApi;
  cfg: LocalEmbeddingConfig;
  logger: Logger;
}): Promise<LocalEmbeddingProvider | null> {
  const providerKey = params.cfg.providerKey ?? params.cfg.provider;
  const apiKey = await resolveApiKey(
    params.api,
    providerKey,
    params.cfg.provider,
    params.cfg.apiKey,
  );
  if (!apiKey && params.cfg.provider !== "ollama") {
    params.logger.warn?.(
      `dual-write: local vector search missing apiKey for provider "${params.cfg.provider}"`,
    );
    return null;
  }

  const baseUrl = params.cfg.baseUrl ?? normalizeBaseUrl(params.cfg.provider);
  if (!baseUrl) {
    params.logger.warn?.("dual-write: local vector search baseUrl is required");
    return null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(params.cfg.headers ?? {}),
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const embedBatch = async (texts: string[]): Promise<number[][]> => {
    const res = await fetch(buildEmbeddingsUrl(baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({ model: params.cfg.model, input: texts }),
    });
    const payload = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      const message =
        payload?.error?.message ??
        (typeof payload === "string" ? payload : `Embeddings failed: ${res.status}`);
      throw new Error(message);
    }
    const rows = payload?.data ?? [];
    return rows.map((row) => normalizeEmbedding(row.embedding ?? []));
  };

  return {
    id: params.cfg.provider,
    model: params.cfg.model,
    embed: async (text) => {
      const [vec] = await embedBatch([text]);
      return vec ?? [];
    },
    embedBatch,
  };
}

export function createLocalEmbeddingFactory(params: {
  api: OpenClawPluginApi;
  cfg: PowerMemConfig;
  agentId: string;
  logger: Logger;
}): LocalEmbeddingFactory | null {
  const config = resolveLocalEmbeddingConfig(params);
  if (!config) {
    return null;
  }
  let providerPromise: Promise<LocalEmbeddingProvider | null> | null = null;
  let disabled = false;

  const get = async () => {
    if (disabled) return null;
    if (!providerPromise) {
      providerPromise = createEmbeddingProvider({
        api: params.api,
        cfg: config,
        logger: params.logger,
      });
    }
    try {
      const provider = await providerPromise;
      if (!provider) {
        disabled = true;
      }
      return provider;
    } catch (err) {
      params.logger.warn?.(`dual-write: local embedding init failed: ${String(err)}`);
      disabled = true;
      return null;
    }
  };

  return { config, get };
}
