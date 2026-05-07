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

function main() {
  const initialFailures = verifyNativePackages();
  if (initialFailures.length === 0) {
    log("native dependencies verified");
    return;
  }

  printFailures(initialFailures);
  warn("native dependency verification failed");
  warn("install build tools first, then run: npm rebuild better-sqlite3 sqlite-vec --build-from-source");
  warn("Debian/Ubuntu example: apt-get update && apt-get install -y python3 make gcc g++");
  process.exit(1);
}

main();
