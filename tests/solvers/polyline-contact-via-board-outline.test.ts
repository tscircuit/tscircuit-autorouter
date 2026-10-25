import { expect, test } from "bun:test"
import { validatePolylineContactRoutes } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/validatePolylineContactRoutes"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("actual concave board containment and margin use the full via copper diameter", (): void => {
  const { context } = createPolylineContactFixture()
  const route = {
    connectionName: "a", traceThickness: 0.1, viaDiameter: 0.6,
    route: [{ x: -0.5, y: 0, z: 0 }, { x: 0.8, y: 0, z: 0 }, { x: 0.8, y: 0, z: 1 }, { x: 0.5, y: 0, z: 1 }],
    vias: [{ x: 0.8, y: 0 }],
  }
  const physical = { ...context, traceWidth: 0.1, boardGeometry: {
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 }, minBoardEdgeClearance: 0.1,
    outline: [[-3, -2], [3, -2], [3, -0.5], [1, -0.5], [1, 0.5], [3, 0.5], [3, 2], [-3, 2]]
      .map(([x, y]) => ({ x: x!, y: y! })),
  } }
  for (const diameter of [0.3, 0.6])
    expect(validatePolylineContactRoutes([{ ...route, viaDiameter: diameter }],
      { ...physical, viaDiameter: diameter })).not.toBeNull()
  expect(validatePolylineContactRoutes([{ ...route, viaDiameter: 0.2 }],
    { ...physical, viaDiameter: 0.2 })).toBeNull()
  expect(validatePolylineContactRoutes([{ ...route, route: route.route.slice(0, 2), vias: [] }], physical)).toBeNull()
})
