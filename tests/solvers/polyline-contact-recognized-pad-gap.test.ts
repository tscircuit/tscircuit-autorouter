import { expect, test } from "bun:test"
import { validatePolylineContactRoutes } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/validatePolylineContactRoutes"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("recognized SMT pads reject via copper gaps that the narrower trace clears", (): void => {
  const { context } = createPolylineContactFixture()
  const routes = [{
    connectionName: "a", traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 1 }],
    vias: [{ x: 0, y: 0 }],
  }]
  const physical = { ...context, obstacles: [{
    type: "rect" as const, center: { x: 0.3, y: 0 }, width: 0.2, height: 0.2,
    layers: ["top"], connectedTo: ["pcb_smtpad_other"],
    circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_other" },
  }] }
  expect(validatePolylineContactRoutes(routes, { ...physical, viaToPadClearance: 0.04 })).toBeNull()
  expect(validatePolylineContactRoutes(routes, { ...physical, viaToPadClearance: 0.1 })).toContain("Via")
  expect(validatePolylineContactRoutes([{ ...routes[0]!, route: [routes[0]!.route[0]!, routes[0]!.route[1]!], vias: [] }],
    { ...physical, viaToPadClearance: 0.1 })).toBeNull()
})
