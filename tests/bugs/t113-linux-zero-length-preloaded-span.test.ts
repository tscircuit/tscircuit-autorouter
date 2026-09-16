import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { SimpleRouteJson } from "lib/types"

test("ignores the exact T113 fanout's duplicate wire span", (): void => {
  const fixturePath = new URL(
    "../../fixtures/bug-reports/t113-linux-exact-pipeline9-root/t113-linux-exact.srj.json.gz",
    import.meta.url,
  )
  const srj = JSON.parse(
    gunzipSync(Uint8Array.from(readFileSync(fixturePath))).toString("utf8"),
  ) as SimpleRouteJson
  const traceIndex = srj.traces?.findIndex(
    (trace) =>
      trace.pcb_trace_id === "fanout:breakout:pcb_breakout_point_68:source-0",
  )
  if (traceIndex === undefined || traceIndex < 0 || !srj.traces) {
    throw new Error("Missing exact T113 breakout trace")
  }
  const trace = srj.traces[traceIndex]!
  const firstDuplicate = trace.route[1]
  const secondDuplicate = trace.route[2]
  if (
    firstDuplicate?.route_type !== "wire" ||
    secondDuplicate?.route_type !== "wire"
  ) {
    throw new Error("Exact T113 breakout trace has no duplicate wire pair")
  }
  expect(Math.abs(firstDuplicate.x - secondDuplicate.x)).toBeLessThanOrEqual(
    1e-9,
  )
  expect(Math.abs(firstDuplicate.y - secondDuplicate.y)).toBeLessThanOrEqual(
    1e-9,
  )
  expect(firstDuplicate.layer).toBe(secondDuplicate.layer)

  const fixedRoutes = convertPreloadedTraceToHdRoutes(
    trace,
    traceIndex,
    srj.layerCount,
    0.45,
    new ConnectivityMap({
      connectivity_net81: [trace.connection_name],
    }),
  )

  expect(traceIndex).toBe(168)
  expect(fixedRoutes).toHaveLength(2)
  expect(
    fixedRoutes.map((route) => [
      route.preloadedRoutePositionStart,
      route.preloadedRoutePositionEnd,
    ]),
  ).toEqual([
    [0, 1],
    [2, 3],
  ])
  expect(
    fixedRoutes.every((route) => {
      const start = route.route[0]!
      const end = route.route.at(-1)!
      return (
        Math.abs(start.x - end.x) > 1e-9 ||
        Math.abs(start.y - end.y) > 1e-9 ||
        start.z !== end.z
      )
    }),
  ).toBeTrue()
})
