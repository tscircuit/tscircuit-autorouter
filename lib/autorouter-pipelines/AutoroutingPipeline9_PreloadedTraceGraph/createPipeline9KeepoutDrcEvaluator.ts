import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"

type DrcError = Record<string, unknown>

/** Retain non-electrical obstacles that have no pad identity in Circuit JSON. */
export const createPipeline9KeepoutDrcEvaluator = (
  inputSrj: SimpleRouteJson,
  traceClearance: number,
  viaClearance: number,
): ((traces: SimplifiedPcbTrace[]) => DrcError[]) => {
  const srj = {
    ...inputSrj,
    traces: undefined,
    obstacles: inputSrj.obstacles.filter(
      (obstacle) =>
        obstacle.connectedTo.length === 0 &&
        !obstacle.netIsAssignable &&
        !obstacle.isCopperPour &&
        !obstacle.isNonPlatedHole &&
        !obstacle.circuitJsonMetadata?.pcb_smtpad_id &&
        !obstacle.circuitJsonMetadata?.pcb_plated_hole_id &&
        !obstacle.circuitJsonMetadata?.pcb_via_id,
    ),
  }
  if (srj.obstacles.length === 0) return (): DrcError[] => []
  const connMap = getConnectivityMapFromSimpleRouteJson(inputSrj)
  return (traces): DrcError[] => {
    const routes = traces.flatMap((trace, traceIndex) =>
      convertPreloadedTraceToHdRoutes(
        trace,
        traceIndex,
        srj.layerCount,
        srj.minViaPadDiameter ?? srj.minViaDiameter ?? 0.3,
        connMap,
      ),
    )
    const errors = new Map<string, { severity: number; error: DrcError }>()
    for (const violation of getFixedObstacleViolations({
      srj,
      routes,
      traceClearance,
      viaClearance,
    })) {
      const trace = traces[routes[violation.routeIndex]!.preloadedTraceIndex]!
      const id = `keepout_${trace.pcb_trace_id}_${violation.obstacleIndex}_${violation.kind}`
      if ((errors.get(id)?.severity ?? -Infinity) >= violation.severity)
        continue
      errors.set(id, {
        severity: violation.severity,
        error: {
          type: "pcb_trace_error",
          error_type: "pcb_trace_error",
          drc_source: "keepout",
          pcb_trace_error_id: id,
          pcb_trace_id: trace.pcb_trace_id,
          center: violation.center,
          minimum_clearance:
            violation.kind === "via" ? viaClearance : traceClearance,
          message: "Routed copper is too close to a non-electrical obstacle",
        },
      })
    }
    return Array.from(errors.values(), ({ error }) => error)
  }
}
