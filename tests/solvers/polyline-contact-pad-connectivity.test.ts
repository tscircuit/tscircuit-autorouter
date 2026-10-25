import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { validatePolylineContactRoutes } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/validatePolylineContactRoutes"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("recognized same-net pad fragments remain connected to their route vias without PCB ports", (): void => {
  const { context } = createPolylineContactFixture()
  const routes = [{
    connectionName: "a_mst1", rootConnectionName: "a", traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 1 }],
    vias: [{ x: 0, y: 0 }],
  }]
  const physical = { ...context, viaToPadClearance: 0.4, obstacles: [0.3, 0.35].map((x) => ({
    type: "rect" as const, center: { x, y: 0 }, width: 0.2, height: 0.2,
    layers: ["top"], connectedTo: ["pcb_smtpad_same"],
    circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_same" },
  })) }
  expect(validatePolylineContactRoutes(routes, {
    ...physical, connMap: new ConnectivityMap({ same: ["a", "pcb_smtpad_same"] }),
  })).toBeNull()
  expect(validatePolylineContactRoutes(routes, {
    ...physical, connMap: new ConnectivityMap({ other: ["other", "pcb_smtpad_same"] }),
  })).toContain("Via")
})
