import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { createCleanSharedRepairCandidate, createSharedRepairGeometryInput, type SharedRepairEvaluatorAccess } from "../fixtures/shared-repair-geometry-input"

test("all five later native evaluator modes retain findings, owner identities, errors, and independent raw maps", (): void => {
  for (const preload of [false, true]) {
    const solvers = [undefined, false, true].map((flag) => new Pipeline9JointDrcRepairSolver(
      createSharedRepairGeometryInput(flag, preload),
    ))
    const original = createCleanSharedRepairCandidate(solvers[0]!.inputNewHdRoutes)
    const retained: Array<{ value: unknown; snapshot: unknown }> = []
    for (let round = 0; round < 20; round++) {
      const routes = structuredClone(original)
      for (const point of routes[1]!.route) point.x = round / 100
      for (const via of routes[1]!.vias) via.x = round / 100
      routes[0]!.traceThickness = round % 3 ? 0.1 : 0.13
      if (round % 4 === 0) {
        routes[1]!.route[2]!.z = 0
        routes[1]!.route[3]!.z = 0
      }
      const before = structuredClone(routes)
      for (const mode of ["drcEvaluator", "cachedReferenceDrcEvaluator",
        "clearancePrecisionDrcEvaluator", "clearancePrecisionIndexedDrcEvaluator"] as const) {
        const values = solvers.map((solver) => (solver as unknown as SharedRepairEvaluatorAccess)[mode](
          { traces: [], routes, hdRoutes: routes },
        ))
        expect(values[1]).toEqual(values[0])
        expect(values[2]).toEqual(values[0])
        for (const value of values) retained.push({ value, snapshot: structuredClone(value) })
      }
      const originalRoutes = round % 2 ? structuredClone(original) : original
      const targets = [{ type: "pcb_via_trace_clearance_error", pcb_trace_id: "horizontal_0",
        pcb_via_id: "via_0", actual_clearance: 0.35, minimum_clearance: 0.1 }]
      const margins = solvers.map((solver) => {
        try {
          return { value: (solver as unknown as SharedRepairEvaluatorAccess)
            .clearanceMarginDrcEvaluator(routes, targets, originalRoutes) }
        } catch (error) {
          if (!(error instanceof Error)) throw error
          return { error: { name: error.name, message: error.message } }
        }
      })
      expect(margins[1]).toEqual(margins[0])
      expect(margins[2]).toEqual(margins[0])
      if (!preload) expect(margins[0]!.error).toBeUndefined()
      expect(routes).toEqual(before)
    }
    for (const entry of retained) expect(entry.value).toEqual(entry.snapshot)
    const native = solvers[0] as unknown as SharedRepairEvaluatorAccess
    const reused = solvers[2] as unknown as SharedRepairEvaluatorAccess
    expect(reused.indexedDrcEvaluationCount).toBe(native.indexedDrcEvaluationCount)
    expect(reused.referenceDrcValidationCount).toBe(native.referenceDrcValidationCount)
    expect(reused.referenceDrcFalseNegativeCount).toBe(native.referenceDrcFalseNegativeCount)
    expect(solvers[2]!.initialRepairConnectivityStats).toEqual({ extraNormalizationCalls: 2,
      sourceMapBuilds: 1, routeMapBuilds: 1, sourceMapReuses: 1, routeMapReuses: 1 })
  }
})
