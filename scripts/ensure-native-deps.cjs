#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const nativePackages = ["better-sqlite3", "sqlite-vec"];

function log(message) {
  console.log(`[memory-powermem] ${message}`);
}

function warn(message) {
  console.warn(`[memory-powermem] ${message}`);
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function tryRequire(packageName) {
  try {
    const resolved = require.resolve(packageName, { paths: [rootDir] });
    require(resolved);
    return null;
  } catch (err) {
    return err;
  }
}

function verifyNativePackages() {
  const failures = [];
  for (const packageName of nativePackages) {
    const err = tryRequire(packageName);
    if (err) {
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

function rebuildNativePackages() {
  log(`rebuilding native dependencies: ${nativePackages.join(", ")}`);
  return spawnSync(
    npmCommand(),
    ["rebuild", ...nativePackages, "--build-from-source"],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        npm_config_ignore_scripts: "false",
      },
      stdio: "inherit",
    },
  );
}

function main() {
  if (process.env.MEMORY_POWERMEM_SKIP_NATIVE_REBUILD === "1") {
    warn("skipping native dependency verification because MEMORY_POWERMEM_SKIP_NATIVE_REBUILD=1");
    return;
  }

  const initialFailures = verifyNativePackages();
  if (initialFailures.length === 0) {
    log("native dependencies verified");
    return;
  }

  printFailures(initialFailures);
  const result = rebuildNativePackages();
  if (result.error) {
    warn(`failed to run npm rebuild: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    warn("native dependency rebuild failed");
    warn("install build tools first, then reinstall or run: npm rebuild better-sqlite3 sqlite-vec --build-from-source");
    warn("Debian/Ubuntu example: apt-get update && apt-get install -y python3 make gcc g++");
    process.exit(result.status ?? 1);
  }

  const finalFailures = verifyNativePackages();
  if (finalFailures.length > 0) {
    printFailures(finalFailures);
    warn("native dependencies still failed after rebuild");
    process.exit(1);
  }

  log("native dependencies rebuilt and verified");
}

main();
