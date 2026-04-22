import { afterEach, describe, expect, it, vi } from "vitest";
import { PowerMemV2Client } from "../src/client-v2.js";

describe("PowerMemV2Client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("adds request config and api key headers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toBe("http://localhost:8000/api/v2/memories");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-API-Key"]).toBe("sk-test");
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body.config).toEqual({ memory_db: { host: "db.local" } });
      return new Response(
        JSON.stringify({
          success: true,
          data: [{ id: "m-1", content: "hello" }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new PowerMemV2Client({
      baseUrl: "http://localhost:8000",
      apiKey: "sk-test",
      userId: "u-1",
      agentId: "a-1",
      requestConfig: { memory_db: { host: "db.local" } },
    });
    const res = await client.add("hello");
    expect(res).toHaveLength(1);
    expect(res[0].memory_id).toBe("m-1");
  });

  it("sends search payload with config", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toBe("http://localhost:8000/api/v2/memories/search");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body).toMatchObject({
        query: "dark mode",
        user_id: "u-1",
        agent_id: "a-1",
        limit: 3,
        config: { vector: "on" },
      });
      return new Response(
        JSON.stringify({
          success: true,
          data: { results: [{ memory_id: 99, content: "prefers dark mode", score: 0.8 }] },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new PowerMemV2Client({
      baseUrl: "http://localhost:8000",
      userId: "u-1",
      agentId: "a-1",
      requestConfig: { vector: "on" },
    });
    const res = await client.search("dark mode", 3);
    expect(res[0].memory_id).toBe("99");
  });

  it("posts delete request with config", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toBe("http://localhost:8000/api/v2/memories/delete/m-9");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body).toMatchObject({
        user_id: "u-9",
        agent_id: "a-9",
        config: { memory_db: { host: "db" } },
      });
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new PowerMemV2Client({
      baseUrl: "http://localhost:8000",
      userId: "u-9",
      agentId: "a-9",
      requestConfig: { memory_db: { host: "db" } },
    });
    await client.delete("m-9");
  });
});
