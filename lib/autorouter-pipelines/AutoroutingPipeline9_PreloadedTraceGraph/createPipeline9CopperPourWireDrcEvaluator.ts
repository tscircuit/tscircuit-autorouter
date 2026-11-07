import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"

/** Pours permit via antipads, but foreign wires must preserve their routing layers. */
export const createPipeline9CopperPourWireDrcEvaluator = (
  inputSrj: SimpleRouteJson,
  srjWithPointPairs: SimpleRouteJson,
): ((traces: SimplifiedPcbTrace[]) => Record<string, unknown>[]) => {
  if (!inputSrj.obstacles.some((obstacle) => obstacle.isCopperPour)) {
    return (): Record<string, unknown>[] => []
  }
  const connMap = getConnectivityMapFromSimpleRouteJson({
    ...srjWithPointPairs,
    traces: inputSrj.traces,
  })
  const srj = {
    ...inputSrj,
    traces: undefined,
    connections: [...srjWithPointPairs.connections, ...inputSrj.connections],
  }
  const clearance = inputSrj.minTraceToPadEdgeClearance ?? 0.1
  return (traces): Record<string, unknown>[] => {
    const routes = traces.flatMap((trace, index) =>
      convertPreloadedTraceToHdRoutes(
        trace,
        index,
        inputSrj.layerCount,
        inputSrj.minViaPadDiameter ?? inputSrj.minViaDiameter ?? 0.3,
        connMap,
      ).map((route) => ({
        ...route,
        rootConnectionName: trace.connection_name,
      })),
    )
    const errors = getFixedObstacleViolations({
      srj,
      routes,
      traceClearance: clearance,
    })
      .filter(
        (violation) =>
          violation.kind === "wire" &&
          inputSrj.obstacles[violation.obstacleIndex]!.isCopperPour,
      )
      .map((violation): Record<string, unknown> => {
        const route = routes[violation.routeIndex]!
        const trace = traces[route.preloadedTraceIndex]!
        return {
          type: "pcb_trace_error",
          error_type: "pcb_trace_error",
          pcb_trace_error_id: `pour_wire_${trace.pcb_trace_id}_${violation.obstacleIndex}`,
          pcb_trace_id: trace.pcb_trace_id,
          center: violation.center,
          actual_clearance: clearance - violation.severity,
          minimum_clearance: clearance,
          message: "Wire crosses a foreign copper-pour routing layer",
        }
      })
    const byTraceAndPour = new Map<string, Record<string, unknown>>()
    for (const error of errors) {
      const key = error.pcb_trace_error_id as string
      const previous = byTraceAndPour.get(key)
      if (
        !previous ||
        (error.actual_clearance as number) <
          (previous.actual_clearance as number)
      ) {
        byTraceAndPour.set(key, error)
      }
    }
    return [...byTraceAndPour.values()]
  }
}
