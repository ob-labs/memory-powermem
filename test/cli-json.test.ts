/**
 * CLI stdout JSON shapes: Python pmem vs powermem-ts.
 */
import { describe, it, expect } from "vitest";
import { normalizeAddOutput, normalizeSearchOutput } from "../client-cli.js";

describe("normalizeAddOutput", () => {
  it("parses powermem-ts AddResult wrapper with memories + memoryId", () => {
    const raw = {
      message: "ok",
      memories: [
        {
          memoryId: "snowflake-1",
          content: "User prefers dark mode",
          userId: "u1",
        },
      ],
    };
    const out = normalizeAddOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("User prefers dark mode");
    expect(String(out[0].memory_id)).toBe("snowflake-1");
  });

  it("parses legacy array of rows", () => {
    const raw = [{ memory_id: 42, content: "x" }];
    expect(normalizeAddOutput(raw)[0].memory_id).toBe(42);
  });
});

describe("normalizeSearchOutput", () => {
  it("parses powermem-ts SearchResult with camelCase memoryId", () => {
    const raw = {
      results: [
        { memoryId: "id-9", content: "coffee", score: 0.9 },
      ],
      total: 1,
      query: "x",
    };
    const out = normalizeSearchOutput(raw);
    expect(out).toHaveLength(1);
    expect(String(out[0].memory_id)).toBe("id-9");
    expect(out[0].score).toBeCloseTo(0.9);
  });
});
