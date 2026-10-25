import { expect, test } from "bun:test"
import { validatePolylineContactRoutes } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/validatePolylineContactRoutes"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("node-valid polylines cannot bypass the actual physical board boundary", (): void => {
  const { solver } = createPolylineContactFixture()
  const error = validatePolylineContactRoutes([{
    connectionName: "a", traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }], vias: [],
  }], {
    ...solver.physicalContext,
    boardGeometry: { bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 } },
  })
  expect(error).not.toBeNull()
})
