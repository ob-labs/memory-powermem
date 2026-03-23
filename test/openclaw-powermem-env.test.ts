import { describe, it, expect } from "vitest";
import {
  buildDefaultSqlitePowermemEnv,
  buildPowermemCliProcessEnv,
} from "../openclaw-powermem-env.js";

describe("buildDefaultSqlitePowermemEnv", () => {
  it("sets sqlite under state dir", () => {
    const e = buildDefaultSqlitePowermemEnv("/tmp/memory-powermem-test-state");
    expect(e.DATABASE_PROVIDER).toBe("sqlite");
    expect(e.SQLITE_PATH).toContain("powermem");
    expect(e.SQLITE_PATH).toContain("powermem.db");
  });
});

describe("buildPowermemCliProcessEnv", () => {
  it("maps OpenAI primary model using provider config apiKey", async () => {
    const env = await buildPowermemCliProcessEnv({
      openclawConfig: {
        agents: { defaults: { model: "openai/gpt-4o-mini" } },
        models: {
          providers: {
            openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-from-config" },
          },
        },
      },
      stateDir: "/tmp/memory-powermem-test-state",
      resolveProviderAuth: async () => ({}),
    });
    expect(env.LLM_PROVIDER).toBe("openai");
    expect(env.LLM_MODEL).toBe("gpt-4o-mini");
    expect(env.LLM_API_KEY).toBe("sk-from-config");
    expect(env.EMBEDDING_PROVIDER).toBe("openai");
    expect(env.EMBEDDING_API_KEY).toBe("sk-from-config");
  });

  it("prefers resolveProviderAuth over inline apiKey", async () => {
    const env = await buildPowermemCliProcessEnv({
      openclawConfig: {
        agents: { defaults: { model: "openai/gpt-4o" } },
        models: {
          providers: {
            openai: { baseUrl: "https://api.openai.com/v1", apiKey: "inline" },
          },
        },
      },
      stateDir: "/tmp/memory-powermem-test-state",
      resolveProviderAuth: async () => ({ apiKey: "from-auth" }),
    });
    expect(env.LLM_API_KEY).toBe("from-auth");
  });

  it("maps qwen and shared embedding", async () => {
    const env = await buildPowermemCliProcessEnv({
      openclawConfig: {
        agents: { defaults: { model: { primary: "qwen/qwen-plus" } } },
        models: {
          providers: {
            qwen: { baseUrl: "https://dashscope.aliyuncs.com", apiKey: "qk" },
          },
        },
      },
      stateDir: "/tmp/memory-powermem-test-state",
      resolveProviderAuth: async () => ({}),
    });
    expect(env.LLM_PROVIDER).toBe("qwen");
    expect(env.LLM_MODEL).toBe("qwen-plus");
    expect(env.EMBEDDING_PROVIDER).toBe("qwen");
  });
});
