import { expect, test } from "bun:test"
import { resolve } from "node:path"

test("fresh pre-import Flatten tolerance preserves Native checker state and declines mismatched worker geometry without observers", () => {
  type Result = { initialTolerance: number; nativeContact: boolean; geometrySnapshotSha256: string; capturedPinned: boolean; getterReads: number; phases: { tolerance: number; batches: number; facts: number; privateMemoEligible: boolean }[]; stats: { protocolFaults: number; workersReserved: number; workersRetired: number } }
  const fixture = resolve(import.meta.dir, "../fixtures/native-reference-tolerance/main.ts")
  let geometrySnapshotSha256: string | undefined
  for (const tolerance of [1e-6, 10, 5e-7]) {
    const run = Bun.spawnSync([process.execPath, fixture, String(tolerance)], { stdout: "pipe", stderr: "pipe" })
    expect(new TextDecoder().decode(run.stderr)).toBe("")
    expect(run.exitCode).toBe(0)
    const result = JSON.parse(new TextDecoder().decode(run.stdout)) as Result
    expect(result.initialTolerance).toBe(tolerance)
    expect(result.capturedPinned).toBe(tolerance === 1e-6)
    expect(result.nativeContact).toBe(tolerance === 10)
    if (geometrySnapshotSha256 === undefined) geometrySnapshotSha256 = result.geometrySnapshotSha256
    expect(result.geometrySnapshotSha256).toBe(geometrySnapshotSha256)
    expect(result.phases[0]!.privateMemoEligible).toBe(true)
    expect(result.getterReads).toBe(0)
    expect(result.stats.protocolFaults).toBe(0)
    expect(result.stats.workersReserved).toBe(result.stats.workersRetired)
    expect(result.phases[1]!.batches).toBe(0)
    expect(result.phases[1]!.facts).toBe(0)
    if (tolerance === 1e-6) {
      expect(result.phases[0]!.facts).toBeGreaterThan(0)
      expect(result.phases[2]!.facts).toBeGreaterThan(0)
    } else {
      expect(result.phases.every((phase) => phase.batches === 0 && phase.facts === 0)).toBe(true)
    }
  }
})
