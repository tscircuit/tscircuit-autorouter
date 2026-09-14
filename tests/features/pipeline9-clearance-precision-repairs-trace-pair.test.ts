import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyPipeline9ClearancePrecisionRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearancePrecisionRepairs"
import { getPipeline9ClearanceMarginErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ClearanceMarginErrors"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("clearance precision repairs a trace pair reported without numeric fields", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "lower",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0, z: 0, pcb_port_id: "lower_start" },
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0, pcb_port_id: "lower_end" },
      ],
      vias: [],
    },
    {
      connectionName: "upper",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0.5, z: 0, pcb_port_id: "upper_start" },
        { x: -1, y: 0.19, z: 0 },
        { x: 1, y: 0.19, z: 0 },
        { x: 2, y: 0.5, z: 0, pcb_port_id: "upper_end" },
      ],
      vias: [],
    },
  ]
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -1, maxX: 3, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    obstacles: [],
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [route.route[0]!, route.route.at(-1)!].map((point) => ({
        x: point.x,
        y: point.y,
        layer: "top" as const,
        pcb_port_id: point.pcb_port_id,
      })),
    })),
  }
  const evaluate = (candidate: HighDensityRoute[]) => {
    const traces: SimplifiedPcbTrace[] = candidate.map((route) => ({
      type: "pcb_trace",
      pcb_trace_id: `${route.connectionName}_0`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, srj.layerCount),
    }))
    return evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: traces,
      drcOptions: { includeTraceContinuity: false, traceClearance: 0.1 },
    })
  }
  const drcEvaluator: DrcEvaluator = ({ routes: candidate, hdRoutes }) => {
    const evaluatedRoutes = candidate ?? hdRoutes
    if (!evaluatedRoutes) throw new Error("Missing candidate routes")
    const result = evaluate(evaluatedRoutes)
    return {
      errors: result.errors as Pipeline9DrcError[],
      errorsWithCenters: result.errorsWithCenters as Pipeline9DrcError[],
    }
  }
  const initial = drcEvaluator({ traces: [], routes })
  if (Array.isArray(initial)) throw new Error("Missing centered DRC result")
  expect(initial.errors).toHaveLength(1)
  expect(initial.errors[0]).not.toHaveProperty("actual_clearance")

  const result = applyPipeline9ClearancePrecisionRepairs({
    srj,
    routes,
    newConnections: [srj.connections[0]!],
    syntheticConnectionNames: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    indexedDrcEvaluator: drcEvaluator,
    candidateDrcEvaluator: drcEvaluator,
    marginDrcEvaluator: (candidate, targets, original) =>
      getPipeline9ClearanceMarginErrors({
        circuitJson: evaluate(candidate).circuitJson,
        originalCircuitJson: evaluate(original).circuitJson,
        targets,
      }),
    drcEvaluator,
    initialErrors: initial.errors as Pipeline9DrcError[],
    initialErrorsWithCenters: initial.errorsWithCenters as Pipeline9DrcError[],
  })

  expect(result.repaired).toBeTrue()
  expect(result.referenceValidationCount).toBe(1)
  expect(evaluate(result.routes).errors).toEqual([])
  expect(result.routes[1]).toEqual(routes[1])
})
