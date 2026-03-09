/**
 * PowerMem CLI backend.
 * Spawns `pmem` (or pmemPath) with -j and parses JSON stdout.
 * Use when mode is "cli" (no HTTP server required).
 */

import { execFileSync } from "node:child_process";
import type { PowerMemConfig } from "./config.js";
import type { PowerMemAddResult, PowerMemSearchResult } from "./client.js";

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MiB

export type PowerMemCLIClientOptions = {
  pmemPath: string;
  envFile?: string;
  userId: string;
  agentId: string;
};

function parseJsonOrThrow<T>(stdout: string, context: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`${context}: empty output`);
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch (err) {
    throw new Error(`${context}: invalid JSON - ${String(err)}`);
  }
}

/** Normalize CLI add result to PowerMemAddResult[]. */
function normalizeAddOutput(raw: unknown): PowerMemAddResult[] {
  if (Array.isArray(raw)) {
    return raw.map((r) => ({
      memory_id: Number((r as Record<string, unknown>).id ?? (r as Record<string, unknown>).memory_id ?? 0),
      content: String((r as Record<string, unknown>).memory ?? (r as Record<string, unknown>).content ?? ""),
      user_id: (r as Record<string, unknown>).user_id as string | undefined,
      agent_id: (r as Record<string, unknown>).agent_id as string | undefined,
      metadata: (r as Record<string, unknown>).metadata as Record<string, unknown> | undefined,
    }));
  }
  const obj = raw as Record<string, unknown>;
  const results = obj?.results ?? obj?.data;
  if (Array.isArray(results)) {
    return results.map((r: Record<string, unknown>) => ({
      memory_id: Number(r.id ?? r.memory_id ?? 0),
      content: String(r.memory ?? r.content ?? ""),
      user_id: r.user_id as string | undefined,
      agent_id: r.agent_id as string | undefined,
      metadata: r.metadata as Record<string, unknown> | undefined,
    }));
  }
  return [];
}

/** Normalize CLI search result to PowerMemSearchResult[]. */
function normalizeSearchOutput(raw: unknown): PowerMemSearchResult[] {
  if (Array.isArray(raw)) {
    return raw.map((r) => ({
      memory_id: Number((r as Record<string, unknown>).memory_id ?? (r as Record<string, unknown>).id ?? 0),
      content: String((r as Record<string, unknown>).content ?? (r as Record<string, unknown>).memory ?? ""),
      score: Number((r as Record<string, unknown>).score ?? (r as Record<string, unknown>).similarity ?? 0),
      metadata: (r as Record<string, unknown>).metadata as Record<string, unknown> | undefined,
    }));
  }
  const obj = raw as Record<string, unknown>;
  const results = obj?.results ?? obj?.data ?? obj?.memories;
  if (Array.isArray(results)) {
    return results.map((r: Record<string, unknown>) => ({
      memory_id: Number(r.memory_id ?? r.id ?? 0),
      content: String(r.content ?? r.memory ?? ""),
      score: Number(r.score ?? r.similarity ?? 0),
      metadata: r.metadata as Record<string, unknown> | undefined,
    }));
  }
  return [];
}

export class PowerMemCLIClient {
  private readonly pmemPath: string;
  private readonly envFile?: string;
  private readonly userId: string;
  private readonly agentId: string;

  constructor(options: PowerMemCLIClientOptions) {
    this.pmemPath = options.pmemPath;
    this.envFile = options.envFile;
    this.userId = options.userId;
    this.agentId = options.agentId;
  }

  static fromConfig(cfg: PowerMemConfig, userId: string, agentId: string): PowerMemCLIClient {
    return new PowerMemCLIClient({
      pmemPath: cfg.pmemPath ?? "pmem",
      envFile: cfg.envFile,
      userId,
      agentId,
    });
  }

  private run(args: string[], context: string): string {
    try {
      const out = execFileSync(this.pmemPath, args, {
        encoding: "utf-8",
        maxBuffer: DEFAULT_MAX_BUFFER,
        env: this.envFile ? { ...process.env, POWERMEM_ENV_FILE: this.envFile } : process.env,
      });
      return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stderr = err && typeof err === "object" && "stderr" in err ? String((err as { stderr: unknown }).stderr) : "";
      throw new Error(`${context}: ${msg}${stderr ? ` ${stderr}` : ""}`);
    }
  }

  async health(): Promise<{ status: string }> {
    const argsList = [
      ...(this.envFile ? ["--env-file", this.envFile] : []),
      "--json", "-j",
      "memory", "list",
      "--user-id", this.userId,
      "--agent-id", this.agentId,
      "--limit", "1",
    ];
    try {
      this.run(argsList, "health");
      return { status: "healthy" };
    } catch {
      return { status: "unhealthy" };
    }
  }

  async add(
    content: string,
    options: { infer?: boolean; metadata?: Record<string, unknown> } = {},
  ): Promise<PowerMemAddResult[]> {
    const args = [
      ...(this.envFile ? ["--env-file", this.envFile] : []),
      "--json", "-j",
      "memory", "add",
      content,
      "--user-id", this.userId,
      "--agent-id", this.agentId,
    ];
    if (options.infer === false) {
      args.push("--no-infer");
    }
    if (options.metadata && Object.keys(options.metadata).length > 0) {
      args.push("--metadata", JSON.stringify(options.metadata));
    }
    const stdout = this.run(args, "add");
    const raw = parseJsonOrThrow<unknown>(stdout, "add");
    return normalizeAddOutput(raw);
  }

  async search(query: string, limit = 5): Promise<PowerMemSearchResult[]> {
    const args = [
      ...(this.envFile ? ["--env-file", this.envFile] : []),
      "--json", "-j",
      "memory", "search",
      query,
      "--user-id", this.userId,
      "--agent-id", this.agentId,
      "--limit", String(limit),
    ];
    const stdout = this.run(args, "search");
    const raw = parseJsonOrThrow<unknown>(stdout, "search");
    return normalizeSearchOutput(raw);
  }

  async delete(memoryId: number | string): Promise<void> {
    const id = String(memoryId);
    const args = [
      ...(this.envFile ? ["--env-file", this.envFile] : []),
      "memory", "delete", id,
      "--user-id", this.userId,
      "--agent-id", this.agentId,
      "--yes",
    ];
    this.run(args, "delete");
  }
}
