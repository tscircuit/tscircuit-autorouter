import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyFixedRouteReplacementsToPreloadedTraces"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { SimpleRouteJson } from "lib/types"

test("restores T113 endpoint ports from preloaded trace connectivity", (): void => {
  const fixturePath = new URL(
    "../../fixtures/bug-reports/t113-linux-exact-pipeline9-root/t113-linux-exact.srj.json.gz",
    import.meta.url,
  )
  const srj = JSON.parse(
    gunzipSync(Uint8Array.from(readFileSync(fixturePath))).toString("utf8"),
  ) as SimpleRouteJson
  const cases = [
    {
      pcbTraceId: "breakout:pcb_breakout_point_33_0",
      endpoint: "start" as const,
      pcbPortId: "pcb_port_63",
    },
    {
      pcbTraceId: "breakout:pcb_breakout_point_32_0",
      endpoint: "end" as const,
      pcbPortId: "pcb_port_62",
    },
  ]

  for (const testCase of cases) {
    const traceIndex = srj.traces?.findIndex(
      (trace) => trace.pcb_trace_id === testCase.pcbTraceId,
    )
    if (traceIndex === undefined || traceIndex < 0 || !srj.traces) {
      throw new Error(`Missing exact T113 trace "${testCase.pcbTraceId}"`)
    }
    const trace = srj.traces[traceIndex]!
    expect(trace.route.some((point) => "start_pcb_port_id" in point)).toBe(
      false,
    )
    expect(trace.route.some((point) => "end_pcb_port_id" in point)).toBe(false)

    const connMap = new ConnectivityMap({
      target_net: [trace.connection_name, ...(trace.connectsTo ?? [])],
    })
    const fixedRoutes = convertPreloadedTraceToHdRoutes(
      trace,
      traceIndex,
      srj.layerCount,
      0.45,
      connMap,
    )
    const { mutatedPreloadedTraces } =
      applyFixedRouteReplacementsToPreloadedTraces({
        originalTraces: srj.traces,
        originalFixedRoutes: fixedRoutes,
        updatedFixedRoutes: fixedRoutes,
        replacedConnectionNames: new Set([fixedRoutes[0]!.connectionName]),
        layerCount: srj.layerCount,
        defaultViaHoleDiameter: 0.3,
        obstacles: srj.obstacles,
        connMap,
      })

    expect(mutatedPreloadedTraces).toHaveLength(1)
    const wirePoints = mutatedPreloadedTraces[0]!.route.filter(
      (point) => point.route_type === "wire",
    )
    const terminalPoint =
      testCase.endpoint === "start" ? wirePoints[0] : wirePoints.at(-1)
    expect(terminalPoint).toMatchObject(
      testCase.endpoint === "start"
        ? { start_pcb_port_id: testCase.pcbPortId }
        : { end_pcb_port_id: testCase.pcbPortId },
    )
  }
})
