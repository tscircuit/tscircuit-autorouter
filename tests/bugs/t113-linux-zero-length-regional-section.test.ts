import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyFixedRouteReplacementsToPreloadedTraces"
import {
  convertPreloadedTraceToHdRoutes,
  type PreloadedHighDensityRoute,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createRegionalFallbackProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const targetTraceId = "fanout:breakout:pcb_breakout_point_68:source-0"
const targetFixedRouteName = "breakout:pcb_breakout_point_68_fixed_168_0"

test("reproduces lost T113 terminal metadata after regional repair", (): void => {
  const fixturePath = new URL(
    "../../fixtures/bug-reports/t113-linux-exact-pipeline9-root/t113-linux-exact.srj.json.gz",
    import.meta.url,
  )
  const srj = JSON.parse(
    gunzipSync(Uint8Array.from(readFileSync(fixturePath))).toString("utf8"),
  ) as SimpleRouteJson
  const traceIndex = srj.traces?.findIndex(
    (trace) => trace.pcb_trace_id === targetTraceId,
  )
  if (traceIndex === undefined || traceIndex < 0 || !srj.traces) {
    throw new Error(`Missing exact T113 trace "${targetTraceId}"`)
  }
  expect(traceIndex).toBe(168)
  const trace = srj.traces[traceIndex]!
  const connMap = new ConnectivityMap({
    connectivity_net81: [trace.connection_name],
  })
  const originalFixedRoutes = convertPreloadedTraceToHdRoutes(
    trace,
    traceIndex,
    srj.layerCount,
    0.45,
    connMap,
  )
  const actualFallbackNode: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_60",
    center: { x: 4.199999999999999, y: 13.904950999999999 },
    width: 3.459995999999999,
    height: 11.090098000000001,
    availableZ: [0, 1, 2, 3],
    portPoints: [
      {
        portPointId: "ce6585_pp2_z0::0",
        x: 2.9600009999999997,
        y: 19.450000000000003,
        z: 0,
        connectionName:
          "source_trace_212__source_trace_213__source_trace_216__source_net_17_mst3",
        rootConnectionName: "source_trace_212",
        nextPortPointId: "ce6725_pp6_z0::0",
      },
      {
        portPointId: "ce6725_pp6_z0::0",
        x: 5.929997999999999,
        y: 18.020019249999997,
        z: 0,
        connectionName:
          "source_trace_212__source_trace_213__source_trace_216__source_net_17_mst3",
        rootConnectionName: "source_trace_212",
        prevPortPointId: "ce6585_pp2_z0::0",
      },
    ],
  }
  actualFallbackNode.portPointsInPairs = [
    [actualFallbackNode.portPoints[0]!, actualFallbackNode.portPoints[1]!],
  ]
  const fallbackProblem = createRegionalFallbackProblem(
    actualFallbackNode,
    originalFixedRoutes,
  )
  const section =
    fallbackProblem.fixedRouteSectionsByConnectionName.get(targetFixedRouteName)
  if (!section) {
    throw new Error(`Missing regional section "${targetFixedRouteName}"`)
  }
  const acceptedReplacement: PreloadedHighDensityRoute = {
    ...originalFixedRoutes[0]!,
    preloadedRoutePositionEnd: 3,
    route: [
      { x: 5, y: 20.1, z: 0 },
      { x: 5, y: 19.45, z: 0 },
      { x: 5.1, y: 19.352, z: 0 },
      { x: 4.949, y: 19.065, z: 0 },
      { x: 4.786, y: 18.583, z: 0 },
      { x: 4.733, y: 18.159, z: 0 },
      { x: 4.7, y: 17.752, z: 0 },
      { x: 5, y: 17.450000000000003, z: 0 },
    ],
  }
  const absorbedConnectionNames = new Set(
    section.sourceRoutes.slice(1).map((route) => route.connectionName),
  )
  const updatedFixedRoutes = originalFixedRoutes.flatMap((route) => {
    if (route.connectionName === targetFixedRouteName) {
      return [acceptedReplacement]
    }
    return absorbedConnectionNames.has(route.connectionName) ? [] : [route]
  })

  const { mutatedPreloadedTraces } =
    applyFixedRouteReplacementsToPreloadedTraces({
      originalTraces: srj.traces,
      originalFixedRoutes,
      updatedFixedRoutes,
      replacedConnectionNames: new Set([targetFixedRouteName]),
      layerCount: srj.layerCount,
      defaultViaHoleDiameter: 0.3,
      obstacles: [],
      connMap,
    })

  expect(section.sourceRoutes.map((route) => route.connectionName)).toEqual([
    "breakout:pcb_breakout_point_68_fixed_168_0",
    "breakout:pcb_breakout_point_68_fixed_168_1",
    "breakout:pcb_breakout_point_68_fixed_168_2",
  ])
  expect(mutatedPreloadedTraces).toHaveLength(1)
  expect(mutatedPreloadedTraces[0]!.route[0]).toMatchObject({
    x: 5,
    y: 20.1,
  })
  expect(mutatedPreloadedTraces[0]!.route[0]).not.toHaveProperty(
    "start_pcb_port_id",
  )
  expect(mutatedPreloadedTraces[0]!.route.at(-1)).toMatchObject({
    x: 5,
    y: 17.450000000000003,
  })
})
