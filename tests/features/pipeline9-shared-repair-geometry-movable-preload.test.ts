import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import {
  createCleanSharedRepairCandidate,
  createSharedRepairGeometryInput,
  type SharedRepairEvaluatorAccess,
} from "../fixtures/shared-repair-geometry-input"

test("prepared handoffs retain movable preload section ownership and the native missing-section error", (): void => {
  const solvers = [undefined, false, true].map((enabled) => {
    const params = createSharedRepairGeometryInput(enabled, true)
    params.updatedPreloadedTraces[0]!.route = [
      { route_type: "wire", x: -2, y: 0.15, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: 0.15, width: 0.1, layer: "top" },
    ]
    return new Pipeline9JointDrcRepairSolver(params)
  })
  for (const solver of solvers) expect(solver.movablePreloadedSections).toHaveLength(1)
  const routes = createCleanSharedRepairCandidate(solvers[0]!.inputNewHdRoutes)
  const synthetic = structuredClone(solvers[0]!.movablePreloadedSections[0]!.hdRoute)
  for (const point of synthetic.route) point.y = 4
  const candidate = [...routes, synthetic]
  const snapshot = structuredClone(candidate)
  const results = solvers.map((solver) => (solver as unknown as SharedRepairEvaluatorAccess)
    .drcEvaluator({ traces: [], routes: candidate }))
  expect(results[1]).toEqual(results[0])
  expect(results[2]).toEqual(results[0])
  expect(candidate).toEqual(snapshot)
  expect(solvers[2]!.sharedRepairGeometryStats!.preparedHandoffUses).toBeGreaterThan(0)
  for (const solver of solvers) {
    const access = solver as unknown as SharedRepairEvaluatorAccess
    expect(() => access.cachedReferenceDrcEvaluator({ traces: [], routes })).toThrow(
      'Pipeline9 joint DRC repair lost preloaded section "pipeline9_preloaded_drc_0"',
    )
  }
})
