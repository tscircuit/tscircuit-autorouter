import { expect, test } from "bun:test"
import { snapIslandEndpointToNearestTerminal } from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import { MAX_STITCH_GAP_DISTANCE_3 } from "lib/solvers/RouteStitchingSolver/routeStitchingShared"

test("island endpoint snapping does not consume a terminal-only finish gap", (): void => {
  const islandEndpoint = { x: 1.2, y: 0, z: 0 }

  expect(
    snapIslandEndpointToNearestTerminal({
      islandEndpoint,
      terminals: [{ x: 0, y: 0, z: 0 }],
      maxSnapDistance: MAX_STITCH_GAP_DISTANCE_3,
    }),
  ).toEqual(islandEndpoint)
})
