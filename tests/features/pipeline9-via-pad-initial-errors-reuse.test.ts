import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyPipeline9ViaPadClearanceRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/apply-pipeline9-via-pad-clearance-repairs"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-joint-drc-repair-utils"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 reuses caller-provided indexed errors when no via-pad residue remains", () => {
  const connection: SimpleRouteConnection = {
    name: "route",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 1, y: 0, layer: "top" },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 2, maxY: 1 },
    obstacles: [],
    connections: [connection],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "route",
      rootConnectionName: "route",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]
  const initialErrors: Pipeline9DrcError[] = [
    {
      type: "pcb_trace_error",
      pcb_trace_id: "route_0",
      center: { x: 0.5, y: 0 },
    },
  ]
  let indexedEvaluationCount = 0
  let referenceEvaluationCount = 0
  const indexedDrcEvaluator = (() => {
    indexedEvaluationCount++
    return { errors: [], errorsWithCenters: [] }
  }) as DrcEvaluator
  const referenceDrcEvaluator = (() => {
    referenceEvaluationCount++
    return { errors: [], errorsWithCenters: [] }
  }) as DrcEvaluator

  const result = applyPipeline9ViaPadClearanceRepairs({
    srj,
    routes,
    fixedObstacleRoutes: [],
    newConnections: [connection],
    syntheticConnectionNames: new Set(),
    drcEvaluator: indexedDrcEvaluator,
    referenceDrcEvaluator,
    initialErrors,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.1,
    effort: 1,
  })

  expect(indexedEvaluationCount).toBe(0)
  expect(referenceEvaluationCount).toBe(0)
  expect(result.routes).toBe(routes)
  expect(result.errors).toBe(initialErrors)
  expect(result.remainingViaPadIssueCount).toBe(0)
})
