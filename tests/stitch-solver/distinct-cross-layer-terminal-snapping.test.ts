import { expect, test } from "bun:test"
import { snapIslandEndpointsToDistinctTerminals } from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"

test("does not assign both island endpoints to one cross-layer terminal", (): void => {
  const snapped = snapIslandEndpointsToDistinctTerminals({
    start: { x: 0, y: 0.1, z: 1 },
    end: { x: 0, y: 0.2, z: 1 },
    globalStart: { x: 0, y: 0, z: 1, pcb_port_id: "bottom_port" },
    globalEnd: { x: 0, y: 3, z: 0, pcb_port_id: "top_port" },
    preferSameLayerTerminalEndpoints: true,
  })

  expect(snapped.start.pcb_port_id).toBe("bottom_port")
  expect(snapped.end).toEqual({ x: 0, y: 0.2, z: 1 })
})
