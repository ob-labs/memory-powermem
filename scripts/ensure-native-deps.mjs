#!/usr/bin/env node
/**
 * Verify native addons load without running shell commands. If load fails,
 * print rebuild instructions and exit 1.
 */

const nativePackages = ["better-sqlite3", "sqlite-vec"];

function log(message) {
  console.log(`[memory-powermem] ${message}`);
}

function warn(message) {
  console.warn(`[memory-powermem] ${message}`);
}

async function verifyNativePackages() {
  const failures = [];
  for (const packageName of nativePackages) {
    try {
      await import(packageName);
    } catch (err) {
      failures.push({ packageName, err });
    }
  }
  return failures;
}

function printFailures(failures) {
  for (const { packageName, err } of failures) {
    warn(`${packageName} failed to load: ${err && err.message ? err.message : String(err)}`);
  }
}

async function main() {
  if (process.env.MEMORY_POWERMEM_SKIP_NATIVE_REBUILD === "1") {
    warn("skipping native dependency verification because MEMORY_POWERMEM_SKIP_NATIVE_REBUILD=1");
    return;
  }

  const initialFailures = await verifyNativePackages();
  if (initialFailures.length === 0) {
    log("native dependencies verified");
    return;
  }

  printFailures(initialFailures);
  warn("install build tools first, then reinstall or run: npm rebuild better-sqlite3 sqlite-vec --build-from-source");
  warn("Debian/Ubuntu example: apt-get update && apt-get install -y python3 make gcc g++");
  process.exit(1);
}

main();
