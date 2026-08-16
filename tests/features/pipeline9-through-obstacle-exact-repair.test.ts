import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { expect, test } from "bun:test"
import { convertPreloadedTraceToSingleHdRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-joint-drc-repair-solver"
import type { SimplifiedPcbTrace } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("Pipeline 9 preserves through-obstacle connectivity in exact repair", () => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fanout-trace",
    connection_name: "ddr3-dq",
    connectsTo: ["ddr3-port", "fanout-exit"],
    route: [
      {
        route_type: "wire",
        x: 0,
        y: 0,
        width: 0.1,
        layer: "top",
      },
      {
        route_type: "through_obstacle",
        start: { x: 0, y: 0 },
        end: { x: 0.4, y: 0.4 },
        from_layer: "top",
        to_layer: "inner10",
        width: 0.1,
        circuitJsonMetadata: { pcb_via_id: "fanout-obstacle" },
      },
      {
        route_type: "wire",
        x: 0.4,
        y: 0.4,
        width: 0.1,
        layer: "inner10",
      },
      {
        route_type: "wire",
        x: 2,
        y: 0.4,
        width: 0.1,
        layer: "inner10",
      },
    ],
  }
  const connMap = new ConnectivityMap({})
  connMap.addConnections([[trace.connection_name, "ddr3-root"]])

  const hdRoute = convertPreloadedTraceToSingleHdRoute({
    trace,
    traceIndex: 0,
    syntheticConnectionName: "movable-fanout-trace",
    layerCount: 18,
    defaultViaDiameter: 0.25,
    connMap,
  })
  const roundTripRoute = convertHdRouteToSimplifiedRoute(hdRoute, 18)

  expect(hdRoute.route[0]).toMatchObject({
    pcb_port_id: "ddr3-port",
    toNextSegmentType: "through_obstacle",
    toNextSegmentCircuitJsonMetadata: {
      pcb_via_id: "fanout-obstacle",
    },
  })
  expect(hdRoute.route.at(-1)).toMatchObject({ pcb_port_id: "fanout-exit" })
  expect(roundTripRoute).toContainEqual({
    route_type: "through_obstacle",
    start: { x: 0, y: 0 },
    end: { x: 0.4, y: 0.4 },
    from_layer: "top",
    to_layer: "inner10",
    width: 0.1,
    circuitJsonMetadata: { pcb_via_id: "fanout-obstacle" },
  })
})
