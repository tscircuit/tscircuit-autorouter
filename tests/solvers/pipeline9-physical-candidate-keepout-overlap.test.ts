import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9PhysicalRouteValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9PhysicalRouteValidator"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("named unowned keepouts enforce copper overlap without adding pad clearance", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    layerCount: 8, minTraceWidth: 0.1, defaultObstacleMargin: 0.8,
    minTraceToPadEdgeClearance: 0.3, minViaEdgeToPadEdgeClearance: 0.3,
    connections: [],
    obstacles: [{ obstacleId: "pcb_keepout_fixed", type: "rect", center: { x: 0.32, y: 0 }, width: 0.3, height: 1, layers: ["inner4"], connectedTo: [] }],
  }
  const route: HighDensityRoute = {
    connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y: -0.5, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 7 }, { x: 0, y: 0.5, z: 7 }], vias: [{ x: 0, y: 0 }],
  }
  const connMap = new ConnectivityMap({})
  const validate = createPipeline9PhysicalRouteValidator({ physicalSrj: srj, connMap, obstacleMargin: 0.8 })
  expect(validate([route])).toBe(true)
  const overlap = { ...route, route: route.route.map((point) => ({ ...point, x: 0.03 })), vias: [{ x: 0.03, y: 0 }] }
  expect(validate([overlap])).toBe(false)
  const pad = { ...srj, obstacles: srj.obstacles.map(({ obstacleId: _, ...obstacle }) => obstacle) }
  expect(createPipeline9PhysicalRouteValidator({ physicalSrj: pad, connMap, obstacleMargin: 0.8 })([route])).toBe(false)
})
