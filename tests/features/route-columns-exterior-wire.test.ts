import { expect, test } from "bun:test"
import { columnPool, columnRoute } from "../fixtures/routeColumnPoolFixtures"

test("whole wires outside the physical board or in a concave notch cannot become independently accepted columns", (): void => {
  const outside = columnRoute("a", [{ x: 2, y: 0, z: 0 }, { x: 2.5, y: 0, z: 0 }])
  const inside = columnRoute("a", [{ x: -0.5, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }])
  const b = columnRoute("b", [{ x: -0.5, y: -0.5, z: 0 }, { x: 0.5, y: -0.5, z: 0 }])
  const boards = [
    { bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 }, minBoardEdgeClearance: 0.1 },
    { bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 }, minBoardEdgeClearance: 0.1,
      outline: [[-3, -2], [3, -2], [3, -0.5], [1, -0.5], [1, 0.5], [3, 0.5], [3, 2], [-3, 2]]
        .map(([x, y]) => ({ x: x!, y: y! })) },
  ]
  for (const boardGeometry of boards) {
    const invalid = columnPool([outside, b], { boardGeometry })
    invalid.offerRoute(outside, "native")
    expect(invalid.params.diagnostics.routeColumnAcceptedColumns ?? 0).toBe(0)
    expect(invalid.params.diagnostics.routeColumnRejected_boardContainment).toBe(1)
    const valid = columnPool([inside, b], { boardGeometry })
    valid.offerRoute(inside, "native")
    expect(valid.params.diagnostics.routeColumnAcceptedColumns).toBe(1)
  }
})
