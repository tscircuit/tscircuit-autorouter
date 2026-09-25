import { expect, test } from "bun:test"
import { snapIslandEndpointToNearestTerminal } from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"

test("snapping preserves distinct coincident terminals on opposite layers", (): void => {
  const topTerminal = { x: 1.98, y: 3.77, z: 0, pcb_port_id: "pcb_port_16" }
  const bottomTerminal = { x: 1.98, y: 3.77, z: 1, pcb_port_id: "pcb_port_334" }

  for (const terminals of [
    [topTerminal, bottomTerminal],
    [bottomTerminal, topTerminal],
  ]) {
    expect(
      snapIslandEndpointToNearestTerminal({
        islandEndpoint: { x: 1.98, y: 3.77, z: 0 },
        terminals,
      }),
    ).toBe(topTerminal)
    expect(
      snapIslandEndpointToNearestTerminal({
        islandEndpoint: { x: 1.98, y: 3.77, z: 1 },
        terminals,
      }),
    ).toBe(bottomTerminal)
  }
})
