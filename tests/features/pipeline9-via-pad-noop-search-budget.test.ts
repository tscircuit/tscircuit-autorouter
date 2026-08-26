import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyPipeline9ViaPadClearanceRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/apply-pipeline9-via-pad-clearance-repairs"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 bounds no-op via-pad relaxation groups by the shared search budget", () => {
  const routeCount = 100
  const connections: SimpleRouteConnection[] = Array.from(
    { length: routeCount },
    (_, routeIndex) => ({
      name: `route_${routeIndex}`,
      pointsToConnect: [
        {
          x: routeIndex * 2,
          y: 0,
          layer: "top",
          pcb_port_id: `start_${routeIndex}`,
        },
        {
          x: routeIndex * 2,
          y: 0,
          layer: "bottom",
          pcb_port_id: `end_${routeIndex}`,
        },
      ],
    }),
  )
  const routes: HighDensityRoute[] = connections.map(
    (connection, routeIndex) => ({
      connectionName: connection.name,
      rootConnectionName: connection.name,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        {
          x: routeIndex * 2,
          y: 0,
          z: 0,
          pcb_port_id: `start_${routeIndex}`,
        },
        {
          x: routeIndex * 2,
          y: 0,
          z: 1,
          pcb_port_id: `end_${routeIndex}`,
        },
      ],
      vias: [{ x: routeIndex * 2, y: 0 }],
    }),
  )
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -1, minY: -1, maxX: routeCount * 2, maxY: 1 },
    obstacles: [],
    connections,
  }
  const indexedDrcEvaluator = ((input: {
    hdRoutes?: HighDensityRoute[]
    routes?: HighDensityRoute[]
  }) => {
    const errors = (input.hdRoutes ?? input.routes ?? []).map(
      (route, routeIndex) => ({
        type: "pcb_pad_pad_clearance_error",
        pcb_trace_id: `${route.connectionName}_0`,
        pcb_via_ids: [`via_${routeIndex}`],
        pcb_pad_ids: [`via_${routeIndex}`, `pad_${routeIndex}`],
        actual_clearance: 0,
        minimum_clearance: 0.1,
        center: route.vias[0],
      }),
    )
    return { errors, errorsWithCenters: errors }
  }) as unknown as DrcEvaluator
  const referenceDrcEvaluator = (() => ({
    errors: [],
    errorsWithCenters: [],
  })) as DrcEvaluator

  const result = applyPipeline9ViaPadClearanceRepairs({
    srj,
    routes,
    fixedObstacleRoutes: [],
    newConnections: connections,
    syntheticConnectionNames: new Set(),
    drcEvaluator: indexedDrcEvaluator,
    referenceDrcEvaluator,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.1,
    effort: 1,
  })

  expect(result.candidateSearchBudget).toBe(70)
  expect(result.candidateSearchCount).toBe(70)
  expect(result.candidateSearchBudgetExhausted).toBeTrue()
  expect(result.relaxationCandidateCount).toBe(70)
  expect(result.attemptedCandidateCount).toBe(0)
  expect(result.routes).toBe(routes)
})
