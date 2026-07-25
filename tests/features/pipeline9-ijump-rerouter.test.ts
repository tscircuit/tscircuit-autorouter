import { expect, test } from "bun:test"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9IjumpRerouter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-ijump-rerouter"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 charges bounded budget when iJump throws before search initialization", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
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
  const rerouter = new Pipeline9IjumpRerouter({
    srj,
    baseObstacles: [],
    connMap,
  })

  const result = rerouter.tryReroute([route], {
    routeIndex: 0,
    includeCandidateCopper: false,
    reverse: false,
    shortenPath: false,
    maxIterations: 17,
  })

  expect(result).toEqual({ iterations: 1 })
})
