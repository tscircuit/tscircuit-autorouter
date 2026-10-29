import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import {
  createCleanSharedRepairCandidate,
  createSharedRepairGeometryInput,
  type SharedRepairEvaluatorAccess,
} from "../fixtures/shared-repair-geometry-input"

test("shared repair geometry removes the synchronous duplicate preparation while retaining full reference validation", (): void => {
  const baseline = new Pipeline9JointDrcRepairSolver(createSharedRepairGeometryInput())
  const candidate = new Pipeline9JointDrcRepairSolver(createSharedRepairGeometryInput(true))
  const originalRoutes = createCleanSharedRepairCandidate(candidate.inputNewHdRoutes)
  const snapshot = structuredClone(originalRoutes)
  const native = baseline as unknown as SharedRepairEvaluatorAccess
  const shared = candidate as unknown as SharedRepairEvaluatorAccess
  const evaluate = (solver: SharedRepairEvaluatorAccess) => solver.drcEvaluator({
    traces: [], routes: originalRoutes, hdRoutes: originalRoutes,
  })
  const expected = evaluate(native)
  expect(evaluate(shared)).toEqual(expected)
  expect(candidate.sharedRepairGeometryStats).toMatchObject({
    preparationCalls: 2,
    preparedInputsBuilt: 1,
    preparedHandoffUses: 1,
    referenceEvaluations: 1,
    indexedEvaluations: 1,
  })
  expect(shared.referenceDrcValidationCount).toBe(1)
  const beforeHit = structuredClone(candidate.sharedRepairGeometryStats!)
  expect(evaluate(shared)).toEqual(expected)
  expect(candidate.sharedRepairGeometryStats).toEqual(beforeHit)
  expect(shared.cachedReferenceDrcEvaluator({ traces: [], routes: originalRoutes })).toEqual(expected)
  expect(candidate.sharedRepairGeometryStats!.referenceCacheHits).toBe(1)
  expect(candidate.sharedRepairGeometryStats!.preparedInputsBuilt).toBe(1)
  expect(originalRoutes).toEqual(snapshot)
  expect(baseline.sharedRepairGeometryStats).toBeUndefined()
  expect(Object.keys(candidate.sharedRepairGeometryStats!)).toHaveLength(16)
  for (const value of Object.values(candidate.sharedRepairGeometryStats!)) {
    expect(Number.isFinite(value)).toBeTrue()
    expect(value).toBeGreaterThanOrEqual(0)
  }
})
