import { expect, test } from "bun:test"
import { snapIslandEndpointToNearestTerminal } from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"

test("layer-aware terminal snapping respects the existing opt-in mode", (): void => {
  const islandEndpoint = { x: 0, y: 0, z: 1 }
  const terminals = [
    { x: 0, y: 0, z: 0 },
    { x: 0.5, y: 0, z: 1 },
  ]
  expect(
    snapIslandEndpointToNearestTerminal({ islandEndpoint, terminals }),
  ).toEqual(terminals[0]!)
  expect(
    snapIslandEndpointToNearestTerminal({
      islandEndpoint,
      terminals,
      preferSameLayerTerminalEndpoints: true,
    }),
  ).toEqual(terminals[1]!)
})
