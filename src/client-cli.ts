/**
 * PowerMem CLI backend.
 * Spawns `pmem` (or pmemPath) with -j and parses JSON stdout.
 * Use when mode is "cli" (no HTTP server required).
 */

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { DEFAULT_PMEM_PATH, type PowerMemConfig } from "./config.js";
import type { PowerMemAddResult, PowerMemSearchResult } from "./client.js";
import { resolvePmemExecutable } from "./resolve-powermem-cli.js";

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MiB

export type PowerMemCLIClientOptions = {
  pmemPath: string;
  /** Path passed to pmem only if the file exists on disk. */
  resolvedEnvFile?: string;
  userId: string;
  agentId: string;
  /**
   * Vars merged into the subprocess environment (after process.env).
   * OpenClaw + SQLite defaults; cached for the plugin process lifetime.
   */
  buildProcessEnv?: () => Promise<Record<string, string>>;
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

function coerceId(v: unknown): string | number {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (s !== "" && /^\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isSafeInteger(n)) return n;
  }
  return s;
}

function mapAddRow(r: Record<string, unknown>): PowerMemAddResult {
  const idRaw = r.memoryId ?? r.memory_id ?? r.id;
  return {
    memory_id: coerceId(idRaw),
    content: String(r.memory ?? r.content ?? ""),
    user_id: (r.userId ?? r.user_id) as string | undefined,
    agent_id: (r.agentId ?? r.agent_id) as string | undefined,
    metadata: r.metadata as Record<string, unknown> | undefined,
  };
}

function mapSearchRow(r: Record<string, unknown>): PowerMemSearchResult {
  const idRaw = r.memory_id ?? r.memoryId ?? r.id;
  return {
    memory_id: coerceId(idRaw),
    content: String(r.content ?? r.memory ?? ""),
    score: Number(r.score ?? r.similarity ?? 0),
    metadata: r.metadata as Record<string, unknown> | undefined,
  };
}

/** Normalize CLI add JSON (Python pmem or powermem-ts) to PowerMemAddResult[]. */
export function normalizeAddOutput(raw: unknown): PowerMemAddResult[] {
  if (Array.isArray(raw)) {
    return raw.map((r) => mapAddRow(r as Record<string, unknown>));
  }
  const obj = raw as Record<string, unknown>;
  const results = obj?.memories ?? obj?.results ?? obj?.data;
  if (Array.isArray(results)) {
    return results.map((r: Record<string, unknown>) => mapAddRow(r));
  }
  return [];
}

/** Normalize CLI search JSON to PowerMemSearchResult[]. */
export function normalizeSearchOutput(raw: unknown): PowerMemSearchResult[] {
  if (Array.isArray(raw)) {
    return raw.map((r) => mapSearchRow(r as Record<string, unknown>));
  }
  const obj = raw as Record<string, unknown>;
  const results = obj?.results ?? obj?.data ?? obj?.memories;
  if (Array.isArray(results)) {
    return results.map((r: Record<string, unknown>) => mapSearchRow(r));
  }
  return [];
}

export class PowerMemCLIClient {
  private readonly pmemPath: string;
  private readonly resolvedEnvFile?: string;
  private readonly userId: string;
  private readonly agentId: string;
  private readonly buildProcessEnv?: () => Promise<Record<string, string>>;
  private injectPromise: Promise<Record<string, string>> | null = null;

  constructor(options: PowerMemCLIClientOptions) {
    this.pmemPath = options.pmemPath;
    this.resolvedEnvFile = options.resolvedEnvFile;
    this.userId = options.userId;
    this.agentId = options.agentId;
    this.buildProcessEnv = options.buildProcessEnv;
  }

  static fromConfig(
    cfg: PowerMemConfig,
    userId: string,
    agentId: string,
    extras?: { buildProcessEnv?: () => Promise<Record<string, string>> },
  ): PowerMemCLIClient {
    const raw = cfg.envFile?.trim();
    const resolved = raw && existsSync(raw) ? raw : undefined;
    return new PowerMemCLIClient({
      pmemPath: resolvePmemExecutable(cfg.pmemPath ?? DEFAULT_PMEM_PATH),
      resolvedEnvFile: resolved,
      userId,
      agentId,
      buildProcessEnv: extras?.buildProcessEnv,
    });
  }

  private async getInjectedEnv(): Promise<Record<string, string>> {
    if (!this.buildProcessEnv) return {};
    if (!this.injectPromise) {
      this.injectPromise = this.buildProcessEnv().catch((err) => {
        this.injectPromise = null;
        throw err;
      });
    }
    return this.injectPromise;
  }

  private async run(args: string[], context: string): Promise<string> {
    const inject = await this.getInjectedEnv();
    const env: NodeJS.ProcessEnv = { ...process.env, ...inject };
    if (this.resolvedEnvFile) {
      env.POWERMEM_ENV_FILE = this.resolvedEnvFile;
    }
    try {
      const out = execFileSync(this.pmemPath, args, {
        encoding: "utf-8",
        maxBuffer: DEFAULT_MAX_BUFFER,
        env,
      });
      return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stderr =
        err && typeof err === "object" && "stderr" in err
          ? String((err as { stderr: unknown }).stderr)
          : "";
      throw new Error(`${context}: ${msg}${stderr ? ` ${stderr}` : ""}`);
    }
  }

  private envFileArgs(): string[] {
    return this.resolvedEnvFile ? ["--env-file", this.resolvedEnvFile] : [];
  }

  async health(): Promise<{ status: string; error?: string }> {
    const argsList = [
      ...this.envFileArgs(),
      "--json",
      "-j",
      "memory",
      "list",
      "--user-id",
      this.userId,
      "--agent-id",
      this.agentId,
      "--limit",
      "1",
    ];
    try {
      await this.run(argsList, "health");
      return { status: "healthy" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "unhealthy", error: msg };
    }
  }

  async add(
    content: string,
    options: { infer?: boolean; metadata?: Record<string, unknown> } = {},
  ): Promise<PowerMemAddResult[]> {
    const args = [
      ...this.envFileArgs(),
      "--json",
      "-j",
      "memory",
      "add",
      content,
      "--user-id",
      this.userId,
      "--agent-id",
      this.agentId,
    ];
    if (options.infer === false) {
      args.push("--no-infer");
    }
    if (options.metadata && Object.keys(options.metadata).length > 0) {
      args.push("--metadata", JSON.stringify(options.metadata));
    }
    const stdout = await this.run(args, "add");
    const raw = parseJsonOrThrow<unknown>(stdout, "add");
    return normalizeAddOutput(raw);
  }

  async search(query: string, limit = 5): Promise<PowerMemSearchResult[]> {
    const args = [
      ...this.envFileArgs(),
      "--json",
      "-j",
      "memory",
      "search",
      query,
      "--user-id",
      this.userId,
      "--agent-id",
      this.agentId,
      "--limit",
      String(limit),
    ];
    const stdout = await this.run(args, "search");
    const raw = parseJsonOrThrow<unknown>(stdout, "search");
    return normalizeSearchOutput(raw);
  }

  async delete(memoryId: number | string): Promise<void> {
    const id = String(memoryId);
    const args = [
      ...this.envFileArgs(),
      "memory",
      "delete",
      id,
      "--user-id",
      this.userId,
      "--agent-id",
      this.agentId,
      "--yes",
    ];
    await this.run(args, "delete");
  }
}
