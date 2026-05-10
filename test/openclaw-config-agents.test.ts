import { describe, it, expect } from "vitest";
import { extractAgentIdsFromOpenClawConfig } from "../src/openclaw-config-agents.js";

describe("extractAgentIdsFromOpenClawConfig", () => {
  it("reads agents.list[].id in order", () => {
    const ids = extractAgentIdsFromOpenClawConfig({
      agents: {
        list: [{ id: "main" }, { id: "researcher", "name": "researcher" }],
      },
    });
    expect(ids).toEqual(["main", "researcher"]);
  });

  it("returns empty when list missing", () => {
    expect(extractAgentIdsFromOpenClawConfig({ agents: {} })).toEqual([]);
    expect(extractAgentIdsFromOpenClawConfig(null)).toEqual([]);
  });

  it("dedupes duplicate ids", () => {
    const ids = extractAgentIdsFromOpenClawConfig({
      agents: { list: [{ id: "a" }, { id: "a" }] },
    });
    expect(ids).toEqual(["a"]);
  });
});
