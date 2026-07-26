import { expect, test } from "bun:test"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9B01Rerouter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-b01-rerouter"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 B01 loads pre-routed traces as fixed route obstacles", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed_wall",
        connection_name: "fixed_net",
        route: [
          { route_type: "wire", x: 0, y: -2, width: 0.1, layer: "top" },
          { route_type: "wire", x: 0, y: 2, width: 0.1, layer: "top" },
        ],
      },
    ],
  }
  const route: HighDensityRoute = {
    connectionName: "missing_from_connectivity_map",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
  }
  const connMap = {
    getNetConnectedToId: () => undefined,
  } as unknown as ConnectivityMap
  const rerouter = new Pipeline9B01Rerouter({
    srj,
    baseObstacles: [],
    connMap,
  })

  const result = rerouter.tryReroute([route], {
    routeIndex: 0,
    includeCandidateCopper: false,
    reverse: false,
    shortenPath: false,
    maxIterations: 50_000,
  })

  expect(result?.route?.route[0]).toEqual(route.route[0])
  expect(result?.route?.route.at(-1)).toEqual(route.route.at(-1))
  expect(result?.route?.route.some((point) => point.z === 1)).toBe(true)
  expect(result?.iterations).toBeLessThanOrEqual(50_000)
})
