import { expect, test } from "bun:test"
import { applyPipeline9ClearanceProjection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearanceProjection"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("partial projection keeps an interior same-net branch attached", (): void => {
  const fixture = createBoundedRegionalRepairFixture(2)
  fixture.routes[0]!.route = [
    { x: -4, y: 0, z: 0 },
    { x: -1, y: 0.28, z: 0 },
    { x: 1, y: 0.28, z: 0 },
    { x: 4, y: 0, z: 0 },
  ]
  fixture.routes[1]!.route = fixture.routes[0]!.route.map((point) => ({
    ...point,
    y: point.y + 1,
  }))
  fixture.originalSrj.connections.push({
    name: "branch",
    rootConnectionName: "signal_0",
    pointsToConnect: [
      { x: 0, y: 0.28, layer: "top" },
      { x: 0.5, y: 0.6, layer: "top", pcb_port_id: "branch_terminal" },
    ],
  })
  fixture.originalSrj.obstacles.push({
    type: "rect",
    center: { x: 0.5, y: 0.6 },
    width: 0.15,
    height: 0.15,
    layers: ["top"],
    connectedTo: ["signal_0", "branch_terminal"],
    circuitJsonMetadata: {
      pcb_smtpad_id: "branch_pad",
      pcb_port_id: "branch_terminal",
    },
  })
  fixture.routes.push({
    connectionName: "branch",
    rootConnectionName: "signal_0",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0.28, z: 0 },
      { x: 0.5, y: 0.6, z: 0, pcb_port_id: "branch_terminal" },
    ],
    vias: [],
  })
  const original = structuredClone(fixture.routes)
  const routes = applyPipeline9ClearanceProjection({
    ...fixture,
    allowPartialRepair: true,
  })
  // The contacted segment is fixed by repair04's existing junction anchors.
  expect(routes[0]).toEqual(original[0])
  expect(routes[2]).toEqual(original[2])
  expect(routes[1]).not.toEqual(original[1])
  expect(fixture.routes).toEqual(original)
})
