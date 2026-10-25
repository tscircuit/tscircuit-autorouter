import { expect, test } from "bun:test"
import { columnPool, columnRoute } from "../fixtures/routeColumnPoolFixtures"

test("physical board via acceptance checks the full copper disk and declared edge margin on rectangles and concave outlines", (): void => {
  const a = columnRoute("a", [
    { x: -0.5, y: 0, z: 0 }, { x: 0.8, y: 0, z: 0 },
    { x: 0.8, y: 0, z: 1 }, { x: 0.5, y: 0, z: 1 },
  ], [{ x: 0.8, y: 0 }])
  const b = columnRoute("b", [{ x: -2, y: 1.5, z: 0 }, { x: 0, y: 1.5, z: 0 }])
  const boards = [
    { bounds: { minX: -3, maxX: 1, minY: -2, maxY: 2 }, minBoardEdgeClearance: 0.1 },
    { bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 }, minBoardEdgeClearance: 0.1,
      outline: [[-3, -2], [3, -2], [3, -0.5], [1, -0.5], [1, 0.5], [3, 0.5], [3, 2], [-3, 2]]
        .map(([x, y]) => ({ x: x!, y: y! })) },
  ]
  for (const boardGeometry of boards) for (const diameter of [0.2, 0.3, 0.6]) {
    const route = { ...a, viaDiameter: diameter }
    const pool = columnPool([route, b], { boardGeometry, viaDiameter: 0.2, viaHoleDiameter: 0.1 })
    pool.offerRoute(route, "native")
    expect(pool.params.diagnostics.routeColumnAcceptedColumns ?? 0).toBe(diameter === 0.2 ? 1 : 0)
    if (diameter > 0.2) expect(pool.params.diagnostics.routeColumnRejected_viaBoard).toBe(1)
  }
})
