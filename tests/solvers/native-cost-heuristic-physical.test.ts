import { expect, test } from "bun:test"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { priorityParams } from "./priorityDagTestUtils"

test("cost-aligned Native priorities retain complete physical routing on crossing tasks", (): void => {
  const params = priorityParams()
  const solver = new PriorityDagIntraNodeSolver({
    ...params,
    hyperParameters: { COST_ALIGNED_HEURISTIC: true },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(solver.solvedRoutes).toHaveLength(3)
  for (let left = 0; left < solver.solvedRoutes.length; left++) {
    const route = solver.solvedRoutes[left]!
    expect(route.rootConnectionName).toBe(`root-${route.connectionName}`)
    const terminals = params.nodeWithPortPoints.portPoints.filter(
      (point) => point.connectionName === route.connectionName,
    )
    const start = terminals[0]!
    const end = terminals.at(-1)!
    expect(route.route[0]).toMatchObject({ x: start.x, y: start.y, z: start.z })
    expect(route.route.at(-1)).toMatchObject({ x: end.x, y: end.y, z: end.z })
    for (let right = 0; right < left; right++) {
      expect(
        doPipeline9RoutesHaveCopperConflict({
          left: route,
          right: solver.solvedRoutes[right]!,
          clearance: 0.1,
          layerCount: 2,
        }),
      ).toBe(false)
    }
  }
})
