import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSqliteStore } from "../src/local-sqlite.js";

type StoreHandle = {
  store: LocalSqliteStore;
};

function createStore(): StoreHandle {
  const dir = mkdtempSync(join(tmpdir(), "powermem-local-"));
  const dbPath = join(dir, "memories.sqlite");
  return { store: new LocalSqliteStore(dbPath) };
}

describe("LocalSqliteStore", () => {
  let handle: StoreHandle | null = null;

  afterEach(() => {
    handle?.store.close();
    handle = null;
  });

  it("stores and searches local memories", () => {
    handle = createStore();
    const id = handle.store.addLocalMemory({
      content: "User prefers dark mode",
      metadata: { importance: 0.7 },
      userId: "u-1",
      agentId: "a-1",
    });
    expect(id).toBeGreaterThan(0);
    const rows = handle.store.search({
      query: "dark mode",
      limit: 5,
      userId: "u-1",
      agentId: "a-1",
    });
    expect(rows[0]?.content).toBe("User prefers dark mode");
  });

  it("upserts remote memory by remote_id", () => {
    handle = createStore();
    handle.store.upsertRemoteMemory({
      remoteId: "r-1",
      content: "Initial content",
      metadata: { source: "remote" },
      userId: "u-2",
      agentId: "a-2",
    });
    handle.store.upsertRemoteMemory({
      remoteId: "r-1",
      content: "Updated content",
      metadata: { source: "remote" },
      userId: "u-2",
      agentId: "a-2",
    });
    const rows = handle.store.search({
      query: "Updated content",
      limit: 5,
      userId: "u-2",
      agentId: "a-2",
    });
    expect(rows[0]?.remote_id).toBe("r-1");
    expect(rows[0]?.content).toBe("Updated content");
  });

  it("tracks pending queue retries", () => {
    handle = createStore();
    handle.store.enqueuePending({
      localMemoryId: 1,
      content: "Queue me",
      metadata: { source: "local" },
      userId: "u-3",
      agentId: "a-3",
      infer: true,
    });
    const pending = handle.store.listPending(10, false);
    expect(pending).toHaveLength(1);
    const id = pending[0].id;
    handle.store.scheduleRetries([id], new Date(Date.now() + 1000).toISOString());
    const retry = handle.store.listPending(10, false);
    expect(retry[0].retries).toBe(1);
    handle.store.removePending([id]);
    expect(handle.store.pendingCount()).toBe(0);
  });
});
