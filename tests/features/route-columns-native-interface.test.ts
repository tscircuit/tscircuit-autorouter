import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { columnPool, columnRoute } from "../fixtures/routeColumnPoolFixtures"

test("column mesh interfaces preserve copper footprints and native terminal stubs while retaining hard node bounds", (): void => {
  const a = columnRoute("a", [
    { x: -6, y: -5.9, z: 0 }, { x: -2, y: -5.9, z: 0 },
    { x: -1, y: -5.85, z: 0 }, { x: 2, y: -5.85, z: 0 }, { x: 6, y: -5.9, z: 0 },
  ])
  const b = columnRoute("b", [{ x: -6, y: 1, z: 0 }, { x: 6, y: 1, z: 0 }])
  const checker = new Native({
    connectionName: "a", regionId: "columns", obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.1,
    bounds: { minX: -6, minY: -6, maxX: 6, maxY: 6 },
    A: a.route[0]!, B: a.route.at(-1)!,
    traceThickness: 0.1, viaDiameter: 0.3, obstacleMargin: 0.15,
  })
  for (const point of a.route.slice(1, -1))
    expect(checker.isNodeTooCloseToEdge({ ...point, parent: null, g: 0, h: 0, f: 0 } as Node, false)).toBe(false)
  const pool = columnPool([a, b], { obstacleMargin: 0.15 })
  pool.offerRoute(a, "native")
  pool.offerRoute(b, "a01")
  expect(pool.solvedRoutes).toHaveLength(2)
  expect(pool.params.diagnostics.routeColumnRejected_nodeInterface).toBeUndefined()
  const gridPoint = { x: -2, y: -5.94, z: 0, parent: null, g: 0, h: 0, f: 0 }
  expect(checker.isNodeTooCloseToEdge(gridPoint, false)).toBe(true)
  const grid = columnPool([a, b], { obstacleMargin: 0.15 })
  grid.offerRoute({ ...a, route: a.route.map((point, index) => index === 1 ? gridPoint : point) }, "a01")
  expect(grid.params.diagnostics.routeColumnAcceptedColumns).toBe(1)
  const outsideFootprint = columnPool([a, b], { obstacleMargin: 0.15 })
  outsideFootprint.offerRoute({ ...a, route: a.route.map((point, index) => index === 1 ? { ...point, y: -5.96 } : point) }, "a01")
  expect(outsideFootprint.params.diagnostics.routeColumnRejected_nodeInterface).toBe(1)
  const invalid = columnPool([a, b], { obstacleMargin: 0.15 })
  invalid.offerRoute({ ...a, route: a.route.map((point, index) => index === 1 ? { ...point, y: -6.01 } : point) }, "native")
  expect(invalid.params.diagnostics.routeColumnRejected_nodeBounds).toBe(1)
})
