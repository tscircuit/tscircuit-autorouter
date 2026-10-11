import { test, expect } from "bun:test"
import { execFileSync } from "node:child_process"

test("dormant indexed memo rejects pre-helper collection, class and proxy observers and preserves native errors", () => {
  const cases = ["engine-equal-source-closure", "source-printer-wrapper", "source-printer-getter", "native-marker-wrapper", "missing-map-global", "metadata-prototype-accessor", "metadata-predicate-accessor", "global-getter-Array", "global-getter-Map", "global-getter-WeakSet", "global-getter-Function", "array-inherited-index", "array-slice", "array-find", "array-some", "array-flatMap", "array-iterator", "slice-proxy", "slice-bound", "map-constructor", "weakset-constructor", "map-proxy-constructor", "engine-predicate", "engine-evaluate", "map-predicate", "math-hypot", "spatial-forgery", "spatial-copy-only", "late-reflection", "data-getter", "trace-proxy", "root-proxy", "numeric-coercion", "map-owned-exception", "retained-aliases", "retained-map", "retirement"]
  for (const which of cases) {
    const output = execFileSync(process.execPath, ["tests/fixtures/native-indexed-connectivity/observer.ts", which], { cwd: process.cwd(), encoding: "utf8" })
    const proof = JSON.parse(output.trim())
    expect(proof.case).toBe(which)
  }
})
