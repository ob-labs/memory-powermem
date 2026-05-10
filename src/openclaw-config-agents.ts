/**
 * Read OpenClaw multi-agent ids from gateway config / openclaw.json shape.
 * Expected: `agents.list[]` entries with string `id` (OpenClaw agent key).
 */

import { readFileSync } from "node:fs";

export function readOpenClawJsonFile(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as unknown;
  } catch {
    return undefined;
  }
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Collect agent keys from `agents.list` (and a few defensive fallbacks).
 */
export function extractAgentIdsFromOpenClawConfig(config: unknown): string[] {
  const c = asRecord(config);
  if (!c) return [];

  const agents = asRecord(c.agents);
  const lists: unknown[] = [];
  if (agents?.list !== undefined) lists.push(agents.list);
  const nestedAgents = asRecord(agents?.agents);
  if (nestedAgents?.list !== undefined) lists.push(nestedAgents.list);

  const out: string[] = [];
  const seen = new Set<string>();

  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const row = asRecord(item);
      const id = typeof row?.id === "string" && row.id.trim() ? row.id.trim() : undefined;
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }

  return out;
}
