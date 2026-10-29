import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import {
  createSharedRepairGeometryInput,
  type SharedRepairEvaluatorAccess,
} from "../fixtures/shared-repair-geometry-input"

test("shared repair preparation preserves named missing-route errors and does not activate for false or omitted flags", (): void => {
  for (const enabled of [undefined, false, true]) {
    const solver = new Pipeline9JointDrcRepairSolver(createSharedRepairGeometryInput(enabled))
    const access = solver as unknown as SharedRepairEvaluatorAccess
    for (const [mode, message] of [
      ["drcEvaluator", "Pipeline9 joint DRC repair requires HD routes"],
      ["cachedReferenceDrcEvaluator", "Pipeline9 cached reference DRC requires HD routes"],
      ["clearancePrecisionDrcEvaluator", "Pipeline9 reference DRC repair requires HD routes"],
      ["clearancePrecisionIndexedDrcEvaluator", "Pipeline9 clearance ranking requires HD routes"],
    ] as const) {
      expect(() => access[mode]({ traces: [] })).toThrow(message)
    }
    if (enabled === true) {
      expect(Object.hasOwn(solver, "sharedRepairGeometryStats")).toBeTrue()
      expect(Object.hasOwn(solver, "sharedRepairCircuitStats")).toBeTrue()
      expect(Object.keys(solver.sharedRepairCircuitStats!)).toHaveLength(16)
      expect(solver.sharedRepairGeometryStats!.preparedInputsBuilt).toBe(0)
      expect(solver.sharedRepairGeometryStats!.referenceEvaluations).toBe(0)
    } else {
      expect(Object.hasOwn(solver, "sharedRepairGeometryStats")).toBeFalse()
      expect(Object.hasOwn(solver, "sharedRepairCircuitStats")).toBeFalse()
      expect(solver.sharedRepairGeometryStats).toBeUndefined()
    }
  }
})
