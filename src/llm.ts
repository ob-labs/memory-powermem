import {
  completeSimple,
  getEnvApiKey,
  getModel,
  type Api,
  type Model,
} from "@mariozechner/pi-ai";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const API_REMAP: Record<string, string> = {
  ollama: "openai-completions",
};

function resolveCompatBaseUrl(originalApi: string, baseUrl: string | undefined): string | undefined {
  if (originalApi === "ollama") {
    const base = (baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
    return base.endsWith("/v1") ? base : `${base}/v1`;
  }
  return baseUrl;
}

type Logger = OpenClawPluginApi["logger"];

function buildModelFromConfig(
  provider: string,
  modelId: string,
  cfg: OpenClawPluginApi["config"],
  logger: Logger,
): Model<Api> | null {
  const providers = cfg?.models?.providers ?? {};
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
  cfg: OpenClawPluginApi["config"],
  logger: Logger,
): Model<Api> | null {
  const builtIn = getModel(provider, modelId) as Model<Api> | null | undefined;
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

  const providers = (cfg?.models?.providers ?? {}) as Record<string, Record<string, unknown>>;
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

export async function callLlm(
  api: OpenClawPluginApi,
  prompt: string,
  opts?: {
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
  },
): Promise<string | null> {
  const cfg = api.config;
  const defaultModel = cfg?.agents?.defaults?.model;
  const primary =
    typeof defaultModel === "string"
      ? defaultModel
      : ((defaultModel as Record<string, unknown> | undefined)?.primary as string | undefined);

  if (!primary?.trim()) {
    api.logger.warn("powermem/llm: no default model configured, skipping");
    return null;
  }

  const slashIdx = primary.indexOf("/");
  if (slashIdx < 0) {
    api.logger.warn(
      `powermem/llm: invalid model format "${primary}", expected "provider/model"`,
    );
    return null;
  }

  const provider = primary.slice(0, slashIdx);
  const modelId = primary.slice(slashIdx + 1);

  api.logger.info?.(`powermem/llm: resolving model ${provider}/${modelId}`);
  const model = resolveModel(provider, modelId, cfg, api.logger);
  if (!model) {
    api.logger.warn(
      `powermem/llm: could not resolve model ${provider}/${modelId}, skipping LLM call`,
    );
    return null;
  }

  api.logger.info?.(`powermem/llm: resolving auth for provider "${provider}"`);
  const apiKey = await resolveApiKey(api, provider);
  if (!apiKey) {
    api.logger.warn(
      `powermem/llm: no apiKey found for provider "${provider}". ` +
      `Ensure openclaw auth, env var, or models.providers.${provider}.apiKey.`,
    );
    return null;
  }

  const messages: Array<{ role: string; content: string; timestamp: number }> = [];
  if (opts?.systemPrompt) {
    messages.push({
      role: "system",
      content: opts.systemPrompt,
      timestamp: Date.now(),
    });
  }
  messages.push({ role: "user", content: prompt, timestamp: Date.now() });

  const maxTokens = opts?.maxTokens ?? 512;
  const temperature = opts?.temperature ?? 0.2;

  try {
    const result = await completeSimple(
      model,
      { messages },
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
