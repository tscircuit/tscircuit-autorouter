import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import {
  createCleanSharedRepairCandidate,
  createSharedRepairGeometryInput,
  type SharedRepairEvaluatorAccess,
} from "../fixtures/shared-repair-geometry-input"

test("shared preparation preserves full findings and cache behavior across mutable geometry, preloads and evaluator modes", (): void => {
  for (const includePreloadedCopper of [false, true]) {
    const controls = [undefined, false, true].map((enabled) => new Pipeline9JointDrcRepairSolver(
      createSharedRepairGeometryInput(enabled, includePreloadedCopper),
    ))
    const candidate = createCleanSharedRepairCandidate(controls[0]!.inputNewHdRoutes)
    for (let round = 0; round < 40; round++) {
      const offset = ((round * 17) % 29) / 100
      candidate[1]!.viaDiameter = round % 2 ? 0.4 : 0.5
      candidate[0]!.traceThickness = round % 3 ? 0.1 : 0.12
      for (const point of candidate[1]!.route) point.x = offset
      for (const via of candidate[1]!.vias) via.x = offset
      if (round % 4 === 0) {
        candidate[1]!.route[2]!.z = 0
        candidate[1]!.route[3]!.z = 0
      } else {
        candidate[1]!.route[2]!.z = 1
        candidate[1]!.route[3]!.z = 1
      }
      const before = structuredClone(candidate)
      for (const mode of [
        "drcEvaluator",
        "cachedReferenceDrcEvaluator",
        "clearancePrecisionDrcEvaluator",
        "clearancePrecisionIndexedDrcEvaluator",
      ] as const) {
        const values = controls.map((solver) => {
          const access = solver as unknown as SharedRepairEvaluatorAccess
          const result = access[mode]({ traces: [], routes: candidate, hdRoutes: candidate })
          return structuredClone(result)
        })
        expect(values[1]).toEqual(values[0])
        expect(values[2]).toEqual(values[0])
      }
      expect(candidate).toEqual(before)
    }
    expect(controls[0]!.sharedRepairGeometryStats).toBeUndefined()
    expect(controls[1]!.sharedRepairGeometryStats).toBeUndefined()
    expect(controls[2]!.sharedRepairGeometryStats!.preparedHandoffUses).toBeGreaterThan(0)
    const native = controls[0] as unknown as SharedRepairEvaluatorAccess
    const shared = controls[2] as unknown as SharedRepairEvaluatorAccess
    expect(shared.indexedDrcEvaluationCount).toBe(native.indexedDrcEvaluationCount)
    expect(shared.referenceDrcValidationCount).toBe(native.referenceDrcValidationCount)
    expect(shared.referenceDrcFalseNegativeCount).toBe(native.referenceDrcFalseNegativeCount)
  }
})
