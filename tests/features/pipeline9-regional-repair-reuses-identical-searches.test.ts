import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyPipeline9RegionalB01Repairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 reuses identical regional DRC searches until geometry changes", (): void => {
  const connection = {
    name: "signal",
    pointsToConnect: [
      { x: -1, y: 0, layer: "top" },
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
  const routes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      rootConnectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]
  const errors = Array.from({ length: 3 }, (_, errorIndex) => ({
    type: "pcb_via_trace_clearance_error",
    pcb_via_trace_clearance_error_id: `same_geometry_${errorIndex}`,
    pcb_trace_id: "signal_0",
    center: { x: 1_000, y: 1_000 },
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
    preloadRepairTraceIds: new Set(["signal_0"]),
    additionalRepairConnectionNames: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    colorMap: { signal: "red" },
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
  })

  expect(result.routes).toBe(routes)
  expect(result).toMatchObject({
    acceptedCandidateCount: 0,
    candidateSearchCount: 6,
    candidateSearchReuseCount: 12,
    candidateSearchBudgetExhausted: false,
    remainingDrcIssueCount: 3,
  })
})
