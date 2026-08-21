import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import {
  applyPipeline9RegionalB01Repairs,
  getPipeline9RegionalRepairSearchBudget,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/apply-pipeline9-regional-b01-repairs"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 bounds failed regional candidate searches by route complexity", () => {
  const connection = {
    name: "route",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 1, y: 0, layer: "top" },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [connection],
  }
  const routes: HighDensityRoute[] = Array.from(
    { length: 500 },
    (_, routeIndex) => ({
      connectionName: "route",
      rootConnectionName: "route",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: routeIndex / 1_000, y: 0, z: 0 },
        { x: 1 + routeIndex / 1_000, y: 0, z: 0 },
      ],
      vias: [],
    }),
  )
  const errors = Array.from({ length: 3 }, (_, errorIndex) => ({
    type: "pcb_trace_error",
    pcb_trace_id: "route_0",
    center: { x: 1_000 + errorIndex, y: 1_000 },
  }))
  const drcEvaluator: DrcEvaluator = () => ({
    errors,
    errorsWithCenters: errors,
  })

  const result = applyPipeline9RegionalB01Repairs({
    srj,
    routes,
    fixedObstacleRoutes: [],
    newConnections: [connection],
    syntheticConnectionNames: new Set(),
    drcEvaluator,
    preloadRepairTraceIds: new Set(["route_0"]),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    colorMap: { route: "red" },
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
  })

  expect(getPipeline9RegionalRepairSearchBudget(70)).toBe(100)
  expect(getPipeline9RegionalRepairSearchBudget(200)).toBe(35)
  expect(result.routes).toBe(routes)
  expect(result).toMatchObject({
    attemptedCandidateCount: 0,
    acceptedCandidateCount: 0,
    candidateSearchCount: 16,
    candidateSearchBudget: 16,
    candidateSearchBudgetExhausted: true,
    safeTraceLayerRepairSkippedForBudget: true,
    remainingDrcIssueCount: 3,
  })
})
