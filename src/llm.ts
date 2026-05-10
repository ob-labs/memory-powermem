import {
  completeSimple,
  getEnvApiKey,
  getModel,
  type Api,
  type Message,
  type Model,
} from "@mariozechner/pi-ai";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/memory-core";
import type { PowerMemConfig } from "./config.js";

const API_REMAP: Record<string, string> = {
  ollama: "openai-completions",
};

/** OpenClaw router placeholders: chat resolves these internally; plugins need a concrete provider/model. */
const ROUTER_PROVIDER_MARKERS = ["auto-router"];

function resolveCompatBaseUrl(originalApi: string, baseUrl: string | undefined): string | undefined {
  if (originalApi === "ollama") {
    const base = (baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
    return base.endsWith("/v1") ? base : `${base}/v1`;
  }
  return baseUrl;
}

type Logger = OpenClawPluginApi["logger"];
type GatewayConfig = {
  models?: {
    providers?: Record<string, unknown>;
  };
  agents?: {
    defaults?: {
      model?: unknown;
      /** Catalog of `provider/model` keys → aliases (OpenClaw router); keys are concrete models except `auto-router/auto`. */
      models?: Record<string, unknown>;
    };
  };
};

function extractPrimaryFromGateway(cfg: unknown): string | undefined {
  const defaultModel = (cfg as GatewayConfig | undefined)?.agents?.defaults?.model;
  if (typeof defaultModel === "string") return defaultModel.trim();
  const primary = (defaultModel as Record<string, unknown> | undefined)?.primary;
  return typeof primary === "string" ? primary.trim() : undefined;
}

/** First non-router `provider/model` key in `agents.defaults.models` (alias catalog). Pairs with `primary: auto-router/auto`. */
function firstConcreteModelFromAgentsDefaultsCatalog(cfg: unknown, logger: Logger): string | null {
  const raw = (cfg as GatewayConfig | undefined)?.agents?.defaults?.models;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const catalog = raw as Record<string, unknown>;
  for (const key of Object.keys(catalog)) {
    const trimmed = key.trim();
    const parsed = parseProviderModel(trimmed);
    if (!parsed) continue;
    if (ROUTER_PROVIDER_MARKERS.includes(parsed.provider.toLowerCase())) continue;
    logger.info?.(`powermem/llm: using agents.defaults.models catalog key — ${trimmed}`);
    return trimmed;
  }
  return null;
}

/** First provider/model found under models.providers (skips router keys). Best-effort when primary is auto-router. */
function firstConcreteModelFromProviders(cfg: unknown, logger: Logger): string | null {
  const providers = (cfg as GatewayConfig | undefined)?.models?.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return null;
  }
  const record = providers as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (ROUTER_PROVIDER_MARKERS.includes(key.toLowerCase())) continue;
    const p = record[key];
    if (!p || typeof p !== "object") continue;
    const modelsList = (p as { models?: Array<{ id?: unknown }> }).models;
    if (!Array.isArray(modelsList)) continue;
    for (const m of modelsList) {
      if (m && typeof m === "object" && typeof (m as { id?: unknown }).id === "string") {
        const id = String((m as { id: string }).id).trim();
        if (id) {
          const spec = `${key}/${id}`;
          logger.info?.(`powermem/llm: using first models.providers model as fallback — ${spec}`);
          return spec;
        }
      }
    }
  }
  return null;
}

function parseProviderModel(spec: string): { provider: string; modelId: string } | null {
  const slashIdx = spec.indexOf("/");
  if (slashIdx <= 0 || slashIdx >= spec.length - 1) return null;
  const provider = spec.slice(0, slashIdx);
  const modelId = spec.slice(slashIdx + 1);
  if (!provider.trim() || !modelId.trim()) return null;
  return { provider, modelId };
}

function pickProviderModelSpec(
  api: OpenClawPluginApi,
  gatewayCfg: unknown,
  memoryCfg: PowerMemConfig | undefined,
): string | null {
  const override = memoryCfg?.pluginLlmModel?.trim();
  if (override) {
    if (!parseProviderModel(override)) {
      api.logger.warn(`powermem/llm: pluginLlmModel must be "provider/model", got "${override}"`);
      return null;
    }
    api.logger.info?.(`powermem/llm: using pluginLlmModel — ${override}`);
    return override;
  }

  const primary = extractPrimaryFromGateway(gatewayCfg);
  if (!primary?.trim()) {
    api.logger.warn("powermem/llm: no default model configured, skipping");
    return null;
  }

  const parsed = parseProviderModel(primary);
  if (!parsed) {
    api.logger.warn(`powermem/llm: invalid model format "${primary}", expected "provider/model"`);
    return null;
  }

  const { provider } = parsed;
  if (ROUTER_PROVIDER_MARKERS.includes(provider.toLowerCase())) {
    const envSpec = process.env.MEMORY_POWERMEM_PLUGIN_LLM_MODEL?.trim();
    if (envSpec && parseProviderModel(envSpec)) {
      api.logger.info?.(
        `powermem/llm: agents.defaults.model is router; using MEMORY_POWERMEM_PLUGIN_LLM_MODEL — ${envSpec}`,
      );
      return envSpec;
    }
    const catalogFallback = firstConcreteModelFromAgentsDefaultsCatalog(gatewayCfg, api.logger);
    if (catalogFallback) return catalogFallback;

    const fallback = firstConcreteModelFromProviders(gatewayCfg, api.logger);
    if (fallback) return fallback;

    api.logger.warn?.(
      `powermem/llm: agents.defaults.model is "${primary}" (router). Set pluginLlmModel, env MEMORY_POWERMEM_PLUGIN_LLM_MODEL, add concrete keys under agents.defaults.models, or ensure models.providers lists models.`,
    );
    return null;
  }

  return primary;
}

function buildModelFromConfig(
  provider: string,
  modelId: string,
  cfg: unknown,
  logger: Logger,
): Model<Api> | null {
  const providers = (cfg as GatewayConfig | undefined)?.models?.providers ?? {};
  const providerCfg =
    (providers as Record<string, unknown>)[provider] ??
    Object.entries(providers).find(([k]) => k.toLowerCase() === provider.toLowerCase())?.[1];

  if (!providerCfg || typeof providerCfg !== "object") {
    logger.warn(`powermem/llm: provider "${provider}" not found in config`);
    return null;
  }

  const cfg_ = providerCfg as Record<string, unknown>;
  const rawApi = (cfg_.api as string | undefined) ?? "openai-completions";
  const configuredBaseUrl = cfg_.baseUrl as string | undefined;

  const effectiveApi = API_REMAP[rawApi] ?? rawApi;
  const effectiveBaseUrl = resolveCompatBaseUrl(rawApi, configuredBaseUrl);

  const modelsList = cfg_.models as Array<Record<string, unknown>> | undefined;
  const modelCfg = modelsList?.find((m) => m.id === modelId);

  logger.info?.(
    `powermem/llm: built model from config — provider=${provider}, model=${modelId}, api=${effectiveApi}, baseUrl=${effectiveBaseUrl ?? "(none)"}`,
  );

  return {
    id: modelId,
    name: modelId,
    api: effectiveApi as Api,
    provider,
    baseUrl: effectiveBaseUrl,
    reasoning: (modelCfg?.reasoning as boolean | undefined) ?? false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow:
      (modelCfg?.contextWindow as number | undefined) ??
      (modelCfg?.maxTokens as number | undefined) ??
      8192,
    maxTokens: (modelCfg?.maxTokens as number | undefined) ?? 4096,
  } as Model<Api>;
}

function resolveModel(
  provider: string,
  modelId: string,
  cfg: unknown,
  logger: Logger,
): Model<Api> | null {
  const builtIn = getModel(provider as any, modelId as any) as Model<Api> | null | undefined;
  if (builtIn) {
    logger.info?.(`powermem/llm: resolved model from built-in catalog — ${provider}/${modelId}`);
    return builtIn;
  }
  logger.info?.(`powermem/llm: model not in built-in catalog, trying user config — ${provider}/${modelId}`);
  return buildModelFromConfig(provider, modelId, cfg, logger);
}

async function resolveApiKey(api: OpenClawPluginApi, provider: string): Promise<string | undefined> {
  const cfg = api.config;

  try {
    const modelAuth = (api.runtime as any)?.modelAuth;
    if (modelAuth?.resolveApiKeyForProvider) {
      const auth = await modelAuth.resolveApiKeyForProvider({ provider, cfg });
      if (auth?.apiKey) {
        api.logger.info?.(`powermem/llm: auth via runtime.modelAuth — provider="${provider}"`);
        return auth.apiKey;
      }
    }
  } catch (e) {
    api.logger.warn(`powermem/llm: runtime.modelAuth failed: ${String(e)}`);
  }

  try {
    const envKey = getEnvApiKey(provider);
    if (envKey) {
      api.logger.info?.(`powermem/llm: auth via env var — provider="${provider}"`);
      return envKey;
    }
  } catch {
    // ignore
  }

  const providers = ((cfg as GatewayConfig | undefined)?.models?.providers ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const providerCfg =
    providers[provider] ??
    Object.values(providers).find(
      (_, idx) => Object.keys(providers)[idx].toLowerCase() === provider.toLowerCase(),
    );
  const configKey = providerCfg?.apiKey as string | undefined;
  if (configKey) {
    api.logger.info?.(`powermem/llm: auth via config apiKey — provider="${provider}"`);
    return configKey;
  }

  return undefined;
}

function resolveModelFromSpec(
  spec: string,
  gatewayCfg: unknown,
  logger: Logger,
): { model: Model<Api>; provider: string } | null {
  const parsed = parseProviderModel(spec);
  if (!parsed) return null;
  const { provider, modelId } = parsed;
  logger.info?.(`powermem/llm: resolving model ${provider}/${modelId}`);
  const model = resolveModel(provider, modelId, gatewayCfg, logger);
  if (!model) return null;
  return { model, provider };
}

export async function callLlm(
  api: OpenClawPluginApi,
  memoryCfg: PowerMemConfig | undefined,
  prompt: string,
  opts?: {
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
  },
): Promise<string | null> {
  const gatewayCfg = api.config;

  let spec = pickProviderModelSpec(api, gatewayCfg, memoryCfg);
  let resolved = spec ? resolveModelFromSpec(spec, gatewayCfg, api.logger) : null;

  if (!resolved) {
    const envSpec = process.env.MEMORY_POWERMEM_PLUGIN_LLM_MODEL?.trim();
    if (envSpec && envSpec !== spec && parseProviderModel(envSpec)) {
      api.logger.info?.(`powermem/llm: retry with MEMORY_POWERMEM_PLUGIN_LLM_MODEL — ${envSpec}`);
      resolved = resolveModelFromSpec(envSpec, gatewayCfg, api.logger);
      if (resolved) spec = envSpec;
    }
  }

  if (!resolved || !spec) {
    if (spec) {
      const parsed = parseProviderModel(spec);
      if (parsed) {
        api.logger.warn(
          `powermem/llm: could not resolve model ${parsed.provider}/${parsed.modelId}, skipping LLM call`,
        );
      }
    }
    return null;
  }

  const { model, provider } = resolved;

  api.logger.info?.(`powermem/llm: resolving auth for provider "${provider}"`);
  const apiKey = await resolveApiKey(api, provider);
  if (!apiKey) {
    api.logger.warn(
      `powermem/llm: no apiKey found for provider "${provider}". ` +
        `Ensure openclaw auth, env var, or models.providers.${provider}.apiKey.`,
    );
    return null;
  }

  const messages: Message[] = [];
  messages.push({ role: "user", content: prompt, timestamp: Date.now() });

  const maxTokens = opts?.maxTokens ?? 512;
  const temperature = opts?.temperature ?? 0.2;

  try {
    const result = await completeSimple(
      model,
      { systemPrompt: opts?.systemPrompt, messages },
      { apiKey, maxTokens, temperature },
    );
    const text = (result.content as Array<{ type: string; text?: string }>)
      ?.filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("")
      .trim();
    return text || null;
  } catch (err) {
    api.logger.warn(`powermem/llm: completeSimple failed: ${String(err)}`);
    return null;
  }
}
