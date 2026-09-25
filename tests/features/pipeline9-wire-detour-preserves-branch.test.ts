import { expect, test } from "bun:test"
import { applyPipeline9IndependentWireDetours } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9IndependentWireDetours"
import { createWireDetourFixture } from "../fixtures/pipeline9-wire-detour-fixture"

test("a wire detour retains an interior same-net branch contact", (): void => {
  const fixture = createWireDetourFixture()
  const via = fixture.routes[2]!
  via.route[1]!.x = 0.5
  via.route[2]!.x = 0.5
  via.vias[0]!.x = 0.5
  fixture.originalSrj.connections.push({
    name: "branch",
    rootConnectionName: "signal_0",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 0, y: -1, layer: "top", pcb_port_id: "branch_end" },
    ],
  })
  fixture.originalSrj.obstacles.push({
    type: "rect",
    center: { x: 0, y: -1 },
    width: 0.1,
    height: 0.1,
    layers: ["top"],
    connectedTo: ["signal_0", "branch_end"],
    circuitJsonMetadata: {
      pcb_smtpad_id: "branch_pad",
      pcb_port_id: "branch_end",
    },
  })
  fixture.routes.push({
    connectionName: "branch",
    rootConnectionName: "signal_0",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: -1, z: 0, pcb_port_id: "branch_end" },
    ],
  })
  const original = structuredClone(fixture.routes)
  const result = applyPipeline9IndependentWireDetours({
    ...fixture,
    maxCandidateAttempts: 8,
    maxPathSearchNodes: 30000,
  })
  expect(result.routes[0]!.route).not.toEqual(original[0]!.route)
  expect(
    result.routes[0]!.route.some((point) => point.x === 0 && point.y === 0),
  ).toBe(true)
  expect(result.routes.slice(1)).toEqual(original.slice(1))
  const reference = fixture.drcEvaluator({ traces: [], routes: result.routes })
  const errors = Array.isArray(reference) ? reference : reference.errors
  expect(errors).toHaveLength(1)
  expect(errors[0]!.type).toBe("pcb_trace_error")
  expect(fixture.routes).toEqual(original)
})
