#!/usr/bin/env node
"use strict";

const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const nativePackages = ["better-sqlite3", "sqlite-vec"];

function log(message) {
  console.log(`[memory-powermem] ${message}`);
}

function warn(message) {
  console.warn(`[memory-powermem] ${message}`);
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

function tryRebuild() {
  const { execSync } = require("node:child_process");
  const packages = nativePackages.join(" ");
  try {
    log(`native binaries incompatible, rebuilding from source: npm rebuild ${packages} --build-from-source`);
    execSync(`npm rebuild ${packages} --build-from-source`, {
      cwd: rootDir,
      stdio: "inherit",
    });
    return true;
  } catch (err) {
    warn(`rebuild failed: ${err && err.message ? err.message : String(err)}`);
    return false;
  }
}

function main() {
  const initialFailures = verifyNativePackages();
  if (initialFailures.length === 0) {
    log("native dependencies verified");
    return;
  }

  printFailures(initialFailures);

  if (!tryRebuild()) {
    warn("install build tools first, then reinstall the plugin");
    warn("Debian/Ubuntu: apt-get update && apt-get install -y python3 make gcc g++");
    process.exit(1);
  }

  const afterFailures = verifyNativePackages();
  if (afterFailures.length === 0) {
    log("native dependencies rebuilt and verified");
    return;
  }

  printFailures(afterFailures);
  warn("rebuild succeeded but native packages still fail to load");
  warn("Debian/Ubuntu: apt-get update && apt-get install -y python3 make gcc g++");
  process.exit(1);
}

main();
