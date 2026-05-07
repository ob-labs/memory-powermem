import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMarkdownImportMarkerKey,
  getMarkdownImportStatus,
  importMarkdownMemories,
} from "../src/markdown-import.js";

describe("importMarkdownMemories", () => {
  it("imports markdown files once and writes a marker", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "pmem-md-workspace-"));
    const stateDir = mkdtempSync(join(tmpdir(), "pmem-md-state-"));
    writeFileSync(join(workspaceDir, "MEMORY.md"), "User prefers concise answers.", "utf-8");
    writeFileSync(join(workspaceDir, "notes.txt"), "not markdown", "utf-8");

    const stored: string[] = [];
    const markerKey = buildMarkdownImportMarkerKey({
      userId: "u",
      agentId: "a",
      workspaceDir,
      paths: ["MEMORY.md"],
    });
    const client = {
      add: async (content: string) => {
        stored.push(content);
        return [{ memory_id: stored.length, content }];
      },
    };

    const first = await importMarkdownMemories({
      client,
      markerPath: join(stateDir, "markdown-imports.json"),
      markerKey,
      workspaceDir,
      paths: ["MEMORY.md"],
      infer: true,
      source: "cli",
    });
    expect(first.skipped).toBe(false);
    expect(first.files).toBe(1);
    expect(first.chunks).toBe(1);
    expect(first.created).toBe(1);
    expect(first.limited).toBe(false);
    expect(first.fileDetails).toMatchObject([
      {
        path: "MEMORY.md",
        status: "imported",
        chunks: 1,
        created: 1,
      },
    ]);
    expect(stored).toEqual(["User prefers concise answers."]);

    const status = getMarkdownImportStatus({
      markerPath: join(stateDir, "markdown-imports.json"),
      markerKey,
      workspaceDir,
      paths: ["MEMORY.md"],
    });
    expect(status.imported).toBe(true);
    expect(status.files).toMatchObject([
      {
        path: "MEMORY.md",
        status: "imported",
        chunks: 1,
        created: 1,
      },
    ]);

    const second = await importMarkdownMemories({
      client,
      markerPath: join(stateDir, "markdown-imports.json"),
      markerKey,
      workspaceDir,
      paths: ["MEMORY.md"],
      infer: true,
      source: "cli",
    });
    expect(second.skipped).toBe(true);
    expect(second.reason).toBe("already_imported");
    expect(stored).toHaveLength(1);
  });

  it("respects max chunk limits", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "pmem-md-workspace-"));
    const stateDir = mkdtempSync(join(tmpdir(), "pmem-md-state-"));
    writeFileSync(join(workspaceDir, "MEMORY.md"), "first paragraph\n\nsecond paragraph", "utf-8");

    const stored: string[] = [];
    const result = await importMarkdownMemories({
      client: {
        add: async (content: string) => {
          stored.push(content);
          return [{ memory_id: stored.length, content }];
        },
      },
      markerPath: join(stateDir, "markdown-imports.json"),
      markerKey: "limit-test",
      workspaceDir,
      paths: ["MEMORY.md"],
      infer: true,
      source: "cli",
      maxChunkChars: 16,
      maxChunks: 1,
    });

    expect(result.limited).toBe(true);
    expect(result.chunks).toBe(1);
    expect(result.fileDetails).toMatchObject([
      {
        path: "MEMORY.md",
        status: "limited",
        chunks: 1,
      },
    ]);
    expect(stored).toHaveLength(1);
  });

  it("reports changed files after import", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "pmem-md-workspace-"));
    const stateDir = mkdtempSync(join(tmpdir(), "pmem-md-state-"));
    const markerPath = join(stateDir, "markdown-imports.json");
    writeFileSync(join(workspaceDir, "MEMORY.md"), "before", "utf-8");

    await importMarkdownMemories({
      client: {
        add: async (content: string) => [{ memory_id: 1, content }],
      },
      markerPath,
      markerKey: "changed-test",
      workspaceDir,
      paths: ["MEMORY.md"],
      infer: true,
      source: "cli",
    });

    writeFileSync(join(workspaceDir, "MEMORY.md"), "after", "utf-8");
    const status = getMarkdownImportStatus({
      markerPath,
      markerKey: "changed-test",
      workspaceDir,
      paths: ["MEMORY.md"],
    });

    expect(status.files[0].status).toBe("imported_changed");
  });
});
