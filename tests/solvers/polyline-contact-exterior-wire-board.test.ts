import { expect, test } from "bun:test"
import { validatePolylineContactRoutes } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/validatePolylineContactRoutes"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("whole wires outside the true board or inside an outline notch are rejected", (): void => {
  const { context } = createPolylineContactFixture()
  const route = { connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 2, y: 0, z: 0 }, { x: 2.5, y: 0, z: 0 }], vias: [] }
  const rectangle = { bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 }, minBoardEdgeClearance: 0.1 }
  const notch = { bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 }, minBoardEdgeClearance: 0.1,
    outline: [[-3, -2], [3, -2], [3, -0.5], [1, -0.5], [1, 0.5], [3, 0.5], [3, 2], [-3, 2]]
      .map(([x, y]) => ({ x: x!, y: y! })) }
  for (const boardGeometry of [rectangle, notch]) {
    expect(validatePolylineContactRoutes([route], { ...context, traceWidth: 0.1, boardGeometry }))
      .toBe("route point outside physical board")
    expect(validatePolylineContactRoutes([{ ...route,
      route: [{ x: -0.5, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }] }],
      { ...context, traceWidth: 0.1, boardGeometry })).toBeNull()
  }
})
