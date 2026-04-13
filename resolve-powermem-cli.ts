/**
 * Resolve the `pmem` executable for CLI mode.
 * - `auto`: npm `powermem` (TypeScript) if installed, else `pmem` on PATH (e.g. Python).
 * - `bundled`: only the `powermem` package entry (fails if missing).
 * - anything else: passed through (absolute path or command name).
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const POWEMEM_CLI_ENTRY = "powermem/dist/cli.js";

export function resolveBundledPowermemCliPath(): string | undefined {
  try {
    return require.resolve(POWEMEM_CLI_ENTRY);
  } catch {
    return undefined;
  }
}

/**
 * @param pmemPath - From config: `auto` | `bundled` | `pmem` | path to binary
 */
export function resolvePmemExecutable(pmemPath: string): string {
  const t = pmemPath.trim();
  if (t === "bundled") {
    const p = resolveBundledPowermemCliPath();
    if (!p) {
      throw new Error(
        'memory-powermem: pmemPath is "bundled" but npm package "powermem" is not installed.',
      );
    }
    return p;
  }
  if (t === "auto" || t === "") {
    const p = resolveBundledPowermemCliPath();
    return p ?? "pmem";
  }
  return t;
}
