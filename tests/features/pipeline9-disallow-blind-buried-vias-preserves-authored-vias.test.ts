import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/apply-fixed-route-replacements-to-preloaded-traces"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import type { SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 preserves untouched authored via spans when another section changes", () => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "authored-partial-vias",
    connection_name: "SIG",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
      {
        route_type: "via",
        x: 1,
        y: 0,
        from_layer: "top",
        to_layer: "inner1",
        via_diameter: 0.55,
      },
      { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "inner1" },
      { route_type: "wire", x: 2, y: 0, width: 0.15, layer: "inner1" },
      {
        route_type: "via",
        x: 2,
        y: 0,
        from_layer: "inner1",
        to_layer: "inner2",
        via_diameter: 0.6,
        via_hole_diameter: 0.32,
      },
      { route_type: "wire", x: 2, y: 0, width: 0.15, layer: "inner2" },
      { route_type: "wire", x: 3, y: 0, width: 0.15, layer: "inner2" },
    ],
  }
  const connMap = new ConnectivityMap({})
  const originalFixedRoutes = convertPreloadedTraceToHdRoutes(
    trace,
    0,
    4,
    0.6,
    connMap,
  )
  const replacedWire = {
    ...originalFixedRoutes[0]!,
    route: [
      originalFixedRoutes[0]!.route[0]!,
      { x: 0.5, y: 0.25, z: 0 },
      originalFixedRoutes[0]!.route.at(-1)!,
    ],
  }

  const getUpdatedTrace = (allowBlindAndBuriedVias?: boolean) =>
    applyFixedRouteReplacementsToPreloadedTraces({
      originalTraces: [trace],
      originalFixedRoutes,
      updatedFixedRoutes: [replacedWire, ...originalFixedRoutes.slice(1)],
      replacedConnectionNames: new Set([
        originalFixedRoutes[0]!.connectionName,
      ]),
      layerCount: 4,
      defaultViaHoleDiameter: 0.3,
      obstacles: [],
      connMap,
      allowBlindAndBuriedVias,
    }).updatedPreloadedTraces[0]!
  const getVias = (allowBlindAndBuriedVias?: boolean) =>
    getUpdatedTrace(allowBlindAndBuriedVias).route.filter(
      (routePoint) => routePoint.route_type === "via",
    )

  const legacyOutput = getUpdatedTrace()
  expect(getUpdatedTrace(true).route).toEqual(legacyOutput.route)
  expect(getVias()).toEqual([
    {
      route_type: "via",
      x: 1,
      y: 0,
      from_layer: "top",
      to_layer: "inner1",
      via_diameter: 0.6,
      via_hole_diameter: 0.3,
    },
    {
      route_type: "via",
      x: 2,
      y: 0,
      from_layer: "inner1",
      to_layer: "inner2",
      via_diameter: 0.6,
      via_hole_diameter: 0.3,
    },
  ])
  expect(getVias(false)).toEqual(
    trace.route.filter((routePoint) => routePoint.route_type === "via"),
  )
  expect(() => getUpdatedTrace("invalid" as unknown as boolean)).toThrow(
    "allowBlindAndBuriedVias must be a boolean when provided",
  )
})
