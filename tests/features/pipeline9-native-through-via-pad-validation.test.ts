import { expect, test } from "bun:test"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import captured from "../fixtures/pipeline9-native-world-guards/srj24-22-cmn396-via-pad.json"

test("ordinary native vias clear foreign top pads even when the local node uses only inner and bottom layers", (): void => {
  const srj = captured.srj as SimpleRouteJson
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const params = {
    connMap,
    layerCount: srj.layerCount,
    traceClearance: 0.1,
    viaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    boardObstacles: srj.obstacles,
    viaToPadClearance: 0.1,
  }
  expect(captured.node.availableZ).toEqual([1, 3])
  expect(srj.minViaEdgeToPadEdgeClearance).toBeUndefined()
  const viaRoutes = (captured.observedRegularRoutes as HighDensityRoute[]).filter((route) => route.vias.length > 0)
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, routes: viaRoutes })).toBeFalse()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, routes: captured.baselineRoutes as HighDensityRoute[] })).toBeTrue()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, allowBlindAndBuriedVias: true, routes: viaRoutes })).toBeTrue()
})
