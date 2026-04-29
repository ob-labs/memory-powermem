import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DualWriteClient } from "../src/dual-write-client.js";
import { LocalSqliteStore } from "../src/local-sqlite.js";

type StoreHandle = {
  store: LocalSqliteStore;
};

function createStore(): StoreHandle {
  const dir = mkdtempSync(join(tmpdir(), "powermem-dual-"));
  const dbPath = join(dir, "dual.sqlite");
  return { store: new LocalSqliteStore(dbPath) };
}

describe("DualWriteClient", () => {
  let handle: StoreHandle | null = null;

  afterEach(() => {
    handle?.store.close();
    handle = null;
  });

  it("queues local writes when remote fails and syncs later", async () => {
    handle = createStore();
    const remote = {
      health: vi.fn(async () => ({ status: "healthy" })),
      add: vi
        .fn()
        .mockRejectedValueOnce(new Error("down"))
        .mockResolvedValueOnce([
          { memory_id: "r-1", content: "remember me", user_id: "u-1", agent_id: "a-1" },
        ]),
      search: vi.fn(),
      delete: vi.fn(),
    };
    const client = new DualWriteClient(remote, handle.store, {
      localUserId: "u-1",
      localAgentId: "a-1",
      syncOnResume: true,
      syncBatchSize: 10,
      syncMinIntervalMs: 0,
      syncBaseDelayMs: 1,
      syncMaxDelayMs: 100,
      syncMaxRetries: 3,
    });

    const created = await client.add("remember me", { infer: true });
    expect(created[0].memory_id).toBeDefined();
    expect(handle.store.pendingCount()).toBe(1);

    await client.syncPending("test");
    expect(handle.store.pendingCount()).toBe(0);

    const rows = handle.store.search({
      query: "remember me",
      limit: 5,
      userId: "u-1",
      agentId: "a-1",
    });
    expect(rows[0]?.remote_id).toBe("r-1");
  });

  it("falls back to local search when remote fails", async () => {
    handle = createStore();
    handle.store.addLocalMemory({
      content: "local only",
      userId: "u-2",
      agentId: "a-2",
    });
    const remote = {
      health: vi.fn(async () => ({ status: "healthy" })),
      add: vi.fn(),
      search: vi.fn(async () => {
        throw new Error("remote down");
      }),
      delete: vi.fn(),
    };
    const client = new DualWriteClient(remote, handle.store, {
      localUserId: "u-2",
      localAgentId: "a-2",
      syncOnResume: true,
      syncBatchSize: 10,
      syncMinIntervalMs: 0,
      syncBaseDelayMs: 1,
      syncMaxDelayMs: 100,
      syncMaxRetries: 3,
    });

    const results = await client.search("local only", 5);
    expect(results[0]?.content).toBe("local only");
  });

  it("uses local-first writes when configured", async () => {
    handle = createStore();
    const remote = {
      health: vi.fn(async () => ({ status: "healthy" })),
      add: vi.fn(async () => [
        { memory_id: "r-local", content: "local first", user_id: "u-3", agent_id: "a-3" },
      ]),
      search: vi.fn(),
      delete: vi.fn(),
    };
    const client = new DualWriteClient(remote, handle.store, {
      localUserId: "u-3",
      localAgentId: "a-3",
      priority: "local",
      syncOnResume: false,
      syncBatchSize: 10,
      syncMinIntervalMs: 0,
      syncBaseDelayMs: 1,
      syncMaxDelayMs: 100,
      syncMaxRetries: 3,
    });

    const created = await client.add("local first", { infer: true });
    expect(created[0]?.content).toBe("local first");
    expect(remote.add).not.toHaveBeenCalled();
    expect(handle.store.pendingCount()).toBe(1);
  });

  it("uses local-first search and only queries remote on local miss", async () => {
    handle = createStore();
    handle.store.addLocalMemory({
      content: "local preferred",
      userId: "u-4",
      agentId: "a-4",
    });
    const remote = {
      health: vi.fn(async () => ({ status: "healthy" })),
      add: vi.fn(),
      search: vi.fn(async () => [
        { memory_id: "r-4", content: "remote fallback", score: 0.9 },
      ]),
      delete: vi.fn(),
    };
    const client = new DualWriteClient(remote, handle.store, {
      localUserId: "u-4",
      localAgentId: "a-4",
      priority: "local",
      syncOnResume: true,
      syncBatchSize: 10,
      syncMinIntervalMs: 0,
      syncBaseDelayMs: 1,
      syncMaxDelayMs: 100,
      syncMaxRetries: 3,
    });

    const localResults = await client.search("local preferred", 5);
    expect(localResults[0]?.content).toBe("local preferred");
    expect(remote.search).not.toHaveBeenCalled();

    const remoteResults = await client.search("remote fallback", 5);
    expect(remoteResults[0]?.content).toBe("remote fallback");
    expect(remote.search).toHaveBeenCalledTimes(1);
  });
});
