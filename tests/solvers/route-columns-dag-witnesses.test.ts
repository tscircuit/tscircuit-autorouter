import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { RouteColumnPool } from "lib/solvers/HighDensitySolver/RouteColumnPool"
import { priorityParams } from "./priorityDagTestUtils"

test("actual DAG branches donate physical alternatives that the restricted master can finish before the DAG", (): void => {
  const params = priorityParams()
  const pool = new RouteColumnPool({
    nodeWithPortPoints: params.nodeWithPortPoints,
    layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1,
    viaHoleDiameter: 0.15, minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    obstacles: [], workLimit: 100_000, diagnostics: {},
  })
  const dag = new PriorityDagIntraNodeSolver({
    ...params,
    onRouteColumn: (route): void => { pool.offerRoute(route, "priority", dag) },
  })
  while (!pool.solvedRoutes && !dag.solved && !dag.failed) dag.step()
  expect(dag.failed).toBe(false)
  expect(pool.exhausted).toBe(false)
  expect(pool.solvedRoutes).toHaveLength(3)
  expect(dag.solved).toBe(false)
  expect(pool.params.diagnostics.routeColumnAcceptedColumns).toBeGreaterThan(3)
  expect(pool.params.diagnostics.routeColumnFinitePoolUnknown).toBeGreaterThan(0)
  expect(pool.params.diagnostics.routeColumnSolvedNodes).toBe(1)
})
