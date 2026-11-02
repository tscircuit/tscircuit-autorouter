import { expect, test } from "bun:test"
import { snapIslandEndpointToNearestTerminal } from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"

test("does not assign a bottom-layer PCB terminal to a top-layer island", () => {
  const islandEndpoint = { x: 0, y: 0, z: 0 }
  const terminal = { x: 0, y: 0, z: 3, pcb_port_id: "bottom-pad" }
  const snapped = snapIslandEndpointToNearestTerminal({
    islandEndpoint,
    terminals: [terminal],
    preferSameLayerTerminalEndpoints: true,
  })

  expect(snapped).toBe(islandEndpoint)
})
