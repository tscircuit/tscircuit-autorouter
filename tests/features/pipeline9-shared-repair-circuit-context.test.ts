import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { createCleanSharedRepairCandidate, createSharedRepairGeometryInput, type SharedRepairEvaluatorAccess } from "../fixtures/shared-repair-geometry-input"

const freezeGeometryContext = (value: unknown): void => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return
  for (const nested of Object.values(value)) freezeGeometryContext(nested)
  Object.freeze(value)
}

test("Joint immutable conversion context survives native regional connectivity alias additions without changing fresh ownership", (): void => {
  const params = [undefined, false, true].map((enabled) => createSharedRepairGeometryInput(enabled, true))
  for (const input of params) freezeGeometryContext(input.originalSrj)
  const solvers = params.map((input) => new Pipeline9JointDrcRepairSolver(input))
  const initial = createCleanSharedRepairCandidate(solvers[0]!.inputNewHdRoutes)
  const evaluate = (candidate: typeof initial): unknown[] => solvers.map((solver) =>
    (solver as unknown as SharedRepairEvaluatorAccess).cachedReferenceDrcEvaluator({ traces: [], routes: candidate }))
  const before = evaluate(initial)
  expect(before[1]).toEqual(before[0])
  expect(before[2]).toEqual(before[0])
  for (let index = 0; index < params.length; index++) {
    params[index]!.connMap.addConnections([["horizontal_regional_0", "horizontal", "extra_alias"]])
  }
  const candidate = structuredClone(initial)
  candidate[0]!.rootConnectionName = "extra_alias"
  candidate[0]!.route[0]!.x += 0.00000001
  const after = evaluate(candidate)
  expect(after[1]).toEqual(after[0])
  expect(after[2]).toEqual(after[0])
  for (const solver of solvers) solver.solve()
  expect(solvers[1]!.getOutput()).toEqual(solvers[0]!.getOutput())
  expect(solvers[2]!.getOutput()).toEqual(solvers[0]!.getOutput())
  expect(solvers[2]!.sharedRepairCircuitStats!.contextBuilds).toBe(2)
  expect(solvers[2]!.sharedRepairCircuitStats!.endpointCacheHits).toBeGreaterThan(0)
})
