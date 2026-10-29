import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { createCleanSharedRepairCandidate, createSharedRepairGeometryInput } from "../fixtures/shared-repair-geometry-input"

test("constructor-clean Joint output still reuses the initial static conversion context without creating the later context", (): void => {
  const solvers = [undefined, false, true].map((enabled) => {
    const params = createSharedRepairGeometryInput(enabled)
    params.newHdRoutes = createCleanSharedRepairCandidate(params.newHdRoutes)
    return new Pipeline9JointDrcRepairSolver(params)
  })
  for (const solver of solvers) expect(solver.solved).toBeTrue()
  expect(solvers[1]!.getOutput()).toEqual(solvers[0]!.getOutput())
  expect(solvers[2]!.getOutput()).toEqual(solvers[0]!.getOutput())
  expect(solvers[2]!.stats).toEqual(solvers[0]!.stats)
  expect(solvers[2]!.sharedRepairGeometryStats!.preparedHandoffUses).toBe(0)
  expect(solvers[2]!.sharedRepairCircuitStats).toMatchObject({
    contextBuilds: 1,
    conversions: 2,
    sourceConnectivityBuilds: 1,
    routeConnectivityBuilds: 1,
    sourceConnectivityReuses: 1,
    sourceResolverBuilds: 1,
    routeResolverBuilds: 1,
  })
})
