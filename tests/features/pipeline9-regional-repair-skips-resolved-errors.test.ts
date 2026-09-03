import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyPipeline9RegionalB01Repairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

type DrcFeedback = {
  errors: Pipeline9DrcError[]
  errorsWithCenters: Pipeline9DrcError[]
}

test("Pipeline9 does not search collisions already cleared by an accepted regional repair", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [{
      name: "signal",
      pointsToConnect: [
        { x: -1, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    }],
  }
  const routes: HighDensityRoute[] = [{
    connectionName: "signal",
    rootConnectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }],
    vias: [],
  }]
  const unresolvedError: Pipeline9DrcError = {
    type: "pcb_trace_error",
    pcb_trace_id: "signal_0",
    pcb_trace_error_id: "overlap_signal_0_unresolved",
    center: { x: 1_000, y: 1_000 },
  }
  const errors: Pipeline9DrcError[] = [0, 1].map((index): Pipeline9DrcError => ({
    type: "pcb_trace_error",
    pcb_trace_id: "signal_0",
    pcb_trace_error_id: `overlap_signal_0_fixed_${index}`,
    center: { x: 0, y: 0 },
  }))
  errors.push(unresolvedError)
  // Model two findings on the same detour: replacing that detour resolves both.
  // The evaluator is deterministic in route geometry, not call count.
  const drcEvaluator: DrcEvaluator = ({ routes, hdRoutes }): DrcFeedback => {
    const candidateRoutes: HighDensityRoute[] | undefined = routes ?? hdRoutes
    if (!candidateRoutes) throw new Error("Missing regional candidate geometry")
    const remainingErrors: Pipeline9DrcError[] = candidateRoutes[0]!.route.some(
      (point): boolean => point.y > 0.25,
    ) ? errors : [unresolvedError]
    return {
      errors: remainingErrors,
      errorsWithCenters: remainingErrors,
    }
  }
  const result: ReturnType<typeof applyPipeline9RegionalB01Repairs> = applyPipeline9RegionalB01Repairs({
    srj,
    routes,
    fixedObstacleRoutes: [],
    newConnections: srj.connections,
    syntheticConnectionNames: new Set(),
    drcEvaluator,
    preloadRepairTraceIds: new Set(["signal_0"]),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    colorMap: { signal: "red" },
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
  })
  expect(result.remainingDrcIssueCount).toBe(1)
  expect(result.acceptedCandidateCount).toBe(1)
  expect(result.candidateSearchCount).toBe(17)
  expect(result.routes[0]!.route[0]).toMatchObject({ x: -1, y: 0, z: 0 })
  expect(result.routes[0]!.route.at(-1)).toMatchObject({ x: 1, y: 0, z: 0 })
})
