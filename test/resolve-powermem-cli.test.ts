import { describe, it, expect } from "vitest";
import {
  resolvePmemExecutable,
  resolveBundledPowermemCliPath,
} from "../resolve-powermem-cli.js";

describe("resolvePmemExecutable", () => {
  it("auto prefers bundled path when powermem is installed", () => {
    const bundled = resolveBundledPowermemCliPath();
    const exe = resolvePmemExecutable("auto");
    if (bundled) {
      expect(exe).toBe(bundled);
    } else {
      expect(exe).toBe("pmem");
    }
  });

  it("pmem passes through", () => {
    expect(resolvePmemExecutable("pmem")).toBe("pmem");
  });

  it("bundled uses the same resolution as auto", () => {
    expect(resolvePmemExecutable("bundled")).toBe(resolvePmemExecutable("auto"));
  });
});
