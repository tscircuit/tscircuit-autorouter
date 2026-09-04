import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyPipeline9RegionalB01Repairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("regional repair distinguishes route fragments on the same connection", (): void => {
  const routes: HighDensityRoute[] = [-0.5, 0.5].map((y, index) => ({
    connectionName: "shared-connection",
    rootConnectionName: index === 0 ? "shared-net" : undefined,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y, z: 0 },
      { x: 2, y, z: 0 },
    ],
    vias: [],
  }))
  const originalRoutes = structuredClone(routes)
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    obstacles: [],
    connections: [],
  }
  const errors = [
    {
      type: "pcb_via_trace_clearance_error",
      pcb_trace_id: "preload-owned",
      center: { x: 0, y: 0 },
    },
  ]
  const candidates: HighDensityRoute[][] = []
  const drcEvaluator: DrcEvaluator = ({ routes, hdRoutes }) => {
    candidates.push(structuredClone(routes ?? hdRoutes ?? []))
    return { errors, errorsWithCenters: errors }
  }
  const result = applyPipeline9RegionalB01Repairs({
    srj,
    routes,
    fixedObstacleRoutes: [],
    newConnections: [],
    syntheticConnectionNames: new Set(),
    drcEvaluator,
    initialErrors: errors,
    preloadRepairTraceIds: new Set(["preload-owned"]),
    connMap: new ConnectivityMap({ "shared-net": ["shared-connection"] }),
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
  })

  expect(result.fallbackCandidateCount).toBeGreaterThan(0)
  expect(candidates.length).toBeGreaterThan(0)
  for (const candidate of candidates) {
    expect(candidate).toHaveLength(routes.length)
    for (const [index, route] of candidate.entries()) {
      expect(route.connectionName).toBe(routes[index]!.connectionName)
      expect(route.rootConnectionName).toBe(routes[index]!.rootConnectionName)
      expect(route.route[0]).toEqual(routes[index]!.route[0])
      expect(route.route.at(-1)).toEqual(routes[index]!.route.at(-1))
    }
  }
  expect(routes).toEqual(originalRoutes)
  expect(result.routes).toEqual(originalRoutes)
})
