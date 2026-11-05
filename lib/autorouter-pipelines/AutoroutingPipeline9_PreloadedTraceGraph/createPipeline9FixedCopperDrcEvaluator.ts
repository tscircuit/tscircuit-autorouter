import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"

type DrcError = Record<string, unknown>

/** Retains earlier copper that has no pad identity in Circuit JSON. */
export const createPipeline9FixedCopperDrcEvaluator = ({
  inputSrj,
  srjWithPointPairs,
  viaClearance,
}: {
  inputSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  viaClearance?: number
}): ((traces: SimplifiedPcbTrace[]) => DrcError[]) => {
  const fixedCopperSrj = {
    ...inputSrj,
    traces: undefined,
    connections: [...srjWithPointPairs.connections, ...inputSrj.connections],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(inputSrj)
  const clearance = Math.max(
    viaClearance ??
      getViaToPadClearance(inputSrj) ??
      RELAXED_DRC_OPTIONS.traceClearance,
    inputSrj.defaultObstacleMargin ?? 0,
    inputSrj.minViaEdgeToPadEdgeClearance ?? 0,
  )
  return (traces): DrcError[] => {
    const viaIds = new Map<string, string>()
    const routes = traces.flatMap((trace, traceIndex) =>
      convertPreloadedTraceToHdRoutes(
        trace,
        traceIndex,
        inputSrj.layerCount,
        inputSrj.minViaPadDiameter ?? inputSrj.minViaDiameter ?? 0.3,
        connMap,
      )
        .filter((route) => route.vias.length > 0)
        .map((route) => {
          const point = trace.route[route.preloadedRoutePositionStart!]!
          if (point.route_type !== "via") {
            throw new Error("Fixed copper via evaluation requires a via point")
          }
          const key = `${point.x},${point.y},${point.from_layer},${point.to_layer}`
          if (!viaIds.has(key)) viaIds.set(key, `via_${viaIds.size}`)
          return {
            ...route,
            rootConnectionName: trace.connection_name,
            pcbViaId: viaIds.get(key)!,
          }
        }),
    )
    return getFixedObstacleViolations({
      srj: fixedCopperSrj,
      routes,
      viaClearance: clearance,
    })
      .filter(({ obstacleIndex }) => {
        const obstacle = inputSrj.obstacles[obstacleIndex]!
        return (
          !obstacle.circuitJsonMetadata &&
          obstacle.connectedTo.length > 0 &&
          !obstacle.isCopperPour &&
          !obstacle.isNonPlatedHole
        )
      })
      .map((violation): DrcError => {
        const trace = traces[routes[violation.routeIndex]!.preloadedTraceIndex]!
        return {
          type: "pcb_via_trace_clearance_error",
          error_type: "pcb_via_trace_clearance_error",
          drc_source: "fixed_copper",
          pcb_via_trace_clearance_error_id: `fixed_copper_${trace.pcb_trace_id}_${violation.obstacleIndex}_${routes[violation.routeIndex]!.pcbViaId}`,
          pcb_via_id: routes[violation.routeIndex]!.pcbViaId,
          pcb_trace_id: trace.pcb_trace_id,
          center: violation.center,
          actual_clearance: clearance - violation.severity,
          minimum_clearance: clearance,
          message: "Via is too close to fixed copper on a drilled layer",
        }
      })
  }
}
