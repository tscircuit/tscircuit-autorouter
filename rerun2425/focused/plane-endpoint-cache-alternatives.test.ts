import { expect, test } from "bun:test"
import { prepareFanoutBuses } from "lib/prepare-buses"
import {
  routeBusAlternatives,
  type RouteBusParams,
  type RouteBusStaticClearanceCache,
} from "lib/route-bus"
import { createSingleSignalFanoutFixture } from "./fixtures/create-single-signal-fanout"

test("cached plane endpoints preserve alternative order and recheck missing entries", (): void => {
  const { simpleRouteJson: srj, bus: spec } = createSingleSignalFanoutFixture({
    direction: "right",
    termination: { type: "plane", layer: "bottom" },
  })
  srj.connections[0]!.pointsToConnect[1] = {
    x: 0.65,
    y: 0.35,
    layer: "top",
    pointId: "nearby-terminal",
  }
  const bus = prepareFanoutBuses(srj, {
    buses: [spec],
    sharedBoundary: srj.bounds,
    escapeLayers: ["top", "bottom"],
  })[0]!
  const staticClearanceCache: RouteBusStaticClearanceCache = new Map()
  const params: RouteBusParams = {
    srj,
    bus,
    targetLayer: "bottom",
    acceptedPlans: [],
    layerNames: ["top", "bottom"],
    traceWidth: srj.minTraceWidth,
    viaDiameter: srj.minViaPadDiameter!,
    viaHoleDiameter: srj.minViaHoleDiameter!,
    clearance: srj.minViaEdgeToPadEdgeClearance!,
    compactBusTracks: true,
    allowBlindAndBuriedVias: false,
    staticClearanceCache,
  }
  const coldAlternatives = routeBusAlternatives(params, 7)
  expect(coldAlternatives).toHaveLength(7)
  expect(coldAlternatives.every((plans) => plans[0]?.planeEndpointTrace)).toBe(
    true,
  )
  expect([...staticClearanceCache.values()]).toContain(false)
  expect([...staticClearanceCache.values()]).toContain(true)
  for (const maximumAlternatives of [1, 2, 7]) {
    expect(routeBusAlternatives(params, maximumAlternatives)).toEqual(
      coldAlternatives.slice(0, maximumAlternatives),
    )
  }
  const rejectedCandidateKeys = [...staticClearanceCache]
    .filter(([, isClear]) => !isClear)
    .map(([cacheKey]) => cacheKey)
  for (const cacheKey of rejectedCandidateKeys) {
    staticClearanceCache.delete(cacheKey)
  }
  expect(routeBusAlternatives(params, 7)).toEqual(coldAlternatives)
  const rejectedCandidatesWereRechecked = rejectedCandidateKeys.every(
    (cacheKey) => staticClearanceCache.get(cacheKey) === false,
  )
  expect(rejectedCandidatesWereRechecked).toBe(true)
})
