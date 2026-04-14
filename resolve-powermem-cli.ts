/**
 * Resolve the `pmem` executable for CLI mode.
 * - `bundled` / `auto` / empty: npm `powermem` next to this plugin if installed, else `pmem` on PATH (e.g. Python).
 * - anything else: passed through (absolute path or command name).
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Resolve npm `powermem`'s CLI script. We cannot use `require.resolve("powermem/dist/cli.js")`
 * because the published package's `exports` field does not expose that subpath.
 */
export function resolveBundledPowermemCliPath(): string | undefined {
  try {
    const main = require.resolve("powermem");
    const cli = join(dirname(main), "cli.js");
    return existsSync(cli) ? cli : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param pmemPath - From config: `auto` | `bundled` | `pmem` | path to binary
 */
export function resolvePmemExecutable(pmemPath: string): string {
  const t = pmemPath.trim();
  if (t === "bundled" || t === "auto" || t === "") {
    const p = resolveBundledPowermemCliPath();
    return p ?? "pmem";
  }
  return t;
}
