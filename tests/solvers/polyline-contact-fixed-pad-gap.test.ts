import { expect, test } from "bun:test"
import { validatePolylineContactRoutes } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/validatePolylineContactRoutes"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("final via-to-pad validation uses the dedicated physical clearance rule", (): void => {
  const { context: physicalContext } = createPolylineContactFixture()
  const routes = [{
    connectionName: "a", traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 1 }],
    vias: [{ x: 0, y: 0 }],
  }]
  const context = { ...physicalContext, obstacles: [{
    type: "rect" as const, center: { x: 0.6, y: 0 }, width: 0.2, height: 0.2,
    layers: ["top"], connectedTo: [],
  }] }
  expect(validatePolylineContactRoutes(routes, context)).toBeNull()
  expect(validatePolylineContactRoutes(routes, { ...context, viaToPadClearance: 0.4 })).not.toBeNull()
})
