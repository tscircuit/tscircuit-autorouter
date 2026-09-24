import { expect, test } from "bun:test"
import { applyPipeline9ClearanceProjection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearanceProjection"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("the existing projection opens a via gap without moving drills or unrelated crossings", (): void => {
  const fixture = createBoundedRegionalRepairFixture(2)
  fixture.originalSrj.obstacles = fixture.originalSrj.obstacles.filter(
    (obstacle) =>
      obstacle.circuitJsonMetadata?.pcb_smtpad_id !== "foreign_pad_0",
  )
  fixture.routes[0]!.route = [
    { x: -4, y: 0, z: 0 },
    { x: -1, y: 0.29, z: 0 },
    { x: 1, y: 0.29, z: 0 },
    { x: 4, y: 0, z: 0 },
  ]
  fixture.routes[1]!.route.splice(1, 1)
  fixture.originalSrj.connections.push({
    name: "via_owner",
    pointsToConnect: [
      { x: 0, y: -2, layer: "top", pcb_port_id: "via_owner_port" },
      { x: 0, y: -2, layer: "bottom", pcb_port_id: "via_owner_port" },
    ],
  })
  fixture.originalSrj.obstacles.push({
    type: "rect",
    center: { x: 0, y: -2 },
    width: 0.3,
    height: 0.3,
    layers: ["top", "bottom"],
    connectedTo: ["via_owner", "via_owner_port"],
    circuitJsonMetadata: {
      pcb_plated_hole_id: "via_owner_terminal",
      pcb_port_id: "via_owner_port",
    },
  })
  fixture.routes.push({
    connectionName: "via_owner",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: -2, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: -2, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  })
  const original = structuredClone(fixture.routes)
  const before = fixture.drcEvaluator({ traces: [], routes: fixture.routes })
  expect(
    (Array.isArray(before) ? before : before.errors).some(
      (error) => error.type === "pcb_via_trace_clearance_error",
    ),
  ).toBe(true)
  const routes = applyPipeline9ClearanceProjection({
    ...fixture,
    allowPartialRepair: true,
  })
  const after = fixture.drcEvaluator({ traces: [], routes })
  const errors = Array.isArray(after) ? after : after.errors
  expect(
    errors.some((error) => error.type === "pcb_via_trace_clearance_error"),
  ).toBe(false)
  expect(errors.some((error) => error.type === "pcb_trace_error")).toBe(true)
  expect(routes[1]).toEqual(original[1])
  expect(routes[2]).toEqual(original[2])
  expect(fixture.routes).toEqual(original)
})
