import { expect, test } from "bun:test"
import { assertOwnerCutProcessCompletion, type OwnerCutChildRecord } from "../scripts/benchmark/runOwnerCutOperatorBenchmark"

test("a fully saved operator report cannot authorize a ratio after a failed or killed child", (): void => {
  const records: OwnerCutChildRecord[] = ["native", "candidate", "candidate", "native"].map((arm, index): OwnerCutChildRecord => ({
    index: index + 1, arm: arm as OwnerCutChildRecord["arm"],
    exitStatus: 0, signal: null, logHash: "b".repeat(64), reportHash: "a".repeat(64),
  }))
  const original = structuredClone(records)
  expect(() => assertOwnerCutProcessCompletion(records)).not.toThrow()
  // All mutations preserve the completed report hash. The exit contract must
  // remain authoritative even if the process dies after its final report save.
  for (const mutation of ["nonzero", "killed", "error", "null-status", "order", "missing-report"] as const) {
    const invalid = structuredClone(records)
    if (mutation === "nonzero") invalid[1]!.exitStatus = 1
    if (mutation === "killed") invalid[1]!.signal = "SIGTERM"
    if (mutation === "error") invalid[1]!.error = "spawnSync timed out after report save"
    if (mutation === "null-status") invalid[1]!.exitStatus = null
    if (mutation === "order") invalid[1]!.arm = "native"
    if (mutation === "missing-report") delete invalid[1]!.reportHash
    expect(() => assertOwnerCutProcessCompletion(invalid)).toThrow()
  }
  expect(() => assertOwnerCutProcessCompletion(records.slice(0, 3))).toThrow()
  expect(records).toEqual(original)
})
