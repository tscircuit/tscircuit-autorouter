import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9PhysicalRouteValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9PhysicalRouteValidator"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("foreign via annuli use the declared pad clearance independently of via-to-pad clearance", (): void => {
  const routes: HighDensityRoute[] = [0, 0.45].map((x, index) => ({
    connectionName: `net${index}`, rootConnectionName: `net${index}`, traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x, y: -1, z: 0 }, { x, y: 0, z: 0 }, { x, y: 0, z: 1 }, { x, y: 1, z: 1 }], vias: [{ x, y: 0 }],
  }))
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, layerCount: 8, minTraceWidth: 0.1,
    obstacles: [], connections: [], minPadEdgeToPadEdgeClearance: 0.2,
    minViaEdgeToPadEdgeClearance: 0.05,
  }
  const connMap = new ConnectivityMap({})
  expect(createPipeline9PhysicalRouteValidator({ physicalSrj: srj, connMap, obstacleMargin: 0.15 })(routes)).toBe(false)
  expect(createPipeline9PhysicalRouteValidator({ physicalSrj: { ...srj, minPadEdgeToPadEdgeClearance: 0.1 }, connMap, obstacleMargin: 0.15 })(routes)).toBe(true)
})
