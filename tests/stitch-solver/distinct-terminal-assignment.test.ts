import { expect, test } from "bun:test"
import { snapIslandEndpointsToTerminals } from "../../lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"

test("island endpoint snapping assigns each terminal at most once", () => {
  const near = { x: 0, y: 0, z: 0, pcb_port_id: "terminal-a" }
  const far = { x: 10, y: 0, z: 0, pcb_port_id: "terminal-b" }
  const start = { x: -0.1, y: 0, z: 0 }
  const end = { x: 0.2, y: 0, z: 0 }
  const partial = snapIslandEndpointsToTerminals({ start, end, terminals: [near, far] })
  expect(partial.start).toBe(near)
  expect(partial.end).toBe(end)
  expect(snapIslandEndpointsToTerminals({ start, end, terminals: [far, near] })).toEqual(partial)
  const other = { x: 0.5, y: 0, z: 0, pcb_port_id: "terminal-c" }
  const complete = snapIslandEndpointsToTerminals({ start, end, terminals: [near, other] })
  expect(complete.start).toBe(near)
  expect(complete.end).toBe(other)
})
