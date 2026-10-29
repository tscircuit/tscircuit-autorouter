import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { createCleanSharedRepairCandidate, createSharedRepairGeometryInput, type SharedRepairEvaluatorAccess } from "../fixtures/shared-repair-geometry-input"

test("early-only native reuse retains full Joint results, counters, and later evaluators", (): void => {
  for (const preload of [false, true]) {
    for (const clean of [false, true]) {
      const solvers = [undefined, false, true].map((flag) => {
        const params = createSharedRepairGeometryInput(flag, preload)
        if (clean) params.newHdRoutes = createCleanSharedRepairCandidate(params.newHdRoutes)
        return new Pipeline9JointDrcRepairSolver(params)
      })
      expect(Object.hasOwn(solvers[0]!, "initialRepairConnectivityStats")).toBeFalse()
      expect(Object.hasOwn(solvers[1]!, "initialRepairConnectivityStats")).toBeFalse()
      const expected = { extraNormalizationCalls: 2, sourceMapBuilds: 1, routeMapBuilds: 1,
        sourceMapReuses: 1, routeMapReuses: 1 }
      expect(solvers[2]!.initialRepairConnectivityStats).toEqual(expected)
      for (const solver of solvers) solver.solve()
      const outputs = solvers.map((solver) => ({ solved: solver.solved, failed: solver.failed,
        error: solver.error, iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS,
        step: solver.currentPipelineStepIndex, routes: solver.getOutput(),
        indexedDrcEvaluationCount: (solver as unknown as SharedRepairEvaluatorAccess).indexedDrcEvaluationCount,
        referenceDrcValidationCount: (solver as unknown as SharedRepairEvaluatorAccess).referenceDrcValidationCount,
        stats: Object.fromEntries(Object.entries(solver.stats).filter(([key]) => !/time|duration|elapsed|Ms$/i.test(key))),
      }))
      expect(outputs[1]).toEqual(outputs[0])
      expect(outputs[2]).toEqual(outputs[0])
      expect(outputs[0]!.solved).toBeTrue()
      expect(solvers[2]!.initialRepairConnectivityStats).toEqual(expected)
    }
  }
})
