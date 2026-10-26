import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { AnyCircuitElement, PcbTraceError } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"

type RawKeepoutDrcError = PcbTraceError & {
  center: { x: number; y: number }
  pcb_keepout_id: string
  minimum_clearance: number
  actual_clearance: number
}

/** Check copper overlap with named, unowned keepouts omitted by Circuit JSON. */
export const getRawKeepoutDrcErrors = ({
  inputSrj,
  jointTraces,
  circuitJson,
}: {
  inputSrj: SimpleRouteJson
  jointTraces: SimplifiedPcbTrace[]
  circuitJson: AnyCircuitElement[]
}): RawKeepoutDrcError[] => {
  const keepouts = inputSrj.obstacles.flatMap((obstacle, obstacleIndex) =>
    obstacle.obstacleId?.startsWith("pcb_keepout_") &&
    obstacle.connectedTo.length === 0
      ? [{ obstacle, obstacleIndex }]
      : [],
  )
  if (keepouts.length === 0) return []

  // These keepouts have no electrical owner, so aliases cannot exempt copper.
  const connMap = new ConnectivityMap({})
  const viaDiameter = getViaDimensions(inputSrj).padDiameter
  const routes = jointTraces.flatMap((trace, traceIndex) =>
    convertPreloadedTraceToHdRoutes(
      trace,
      traceIndex,
      inputSrj.layerCount,
      viaDiameter,
      connMap,
    ),
  )
  const circuitTracesById = new Map(
    circuitJson.flatMap((element) =>
      element.type === "pcb_trace"
        ? [[element.pcb_trace_id, element] as const]
        : [],
    ),
  )
  const violations = getFixedObstacleViolations({
    srj: {
      ...inputSrj,
      traces: undefined,
      obstacles: keepouts.map(({ obstacle }) => obstacle),
      // Routing margins are not an additional physical keepout clearance rule.
      defaultObstacleMargin: 0,
      minTraceToPadEdgeClearance: 0,
      minViaEdgeToPadEdgeClearance: 0,
    },
    routes,
    traceClearance: 0,
    viaClearance: 0,
  })
  const errorsByPair = new Map<
    string,
    { severity: number; error: RawKeepoutDrcError }
  >()
  for (const violation of violations) {
    const route = routes[violation.routeIndex]!
    const trace = jointTraces[route.preloadedTraceIndex]!
    const circuitTrace = circuitTracesById.get(trace.pcb_trace_id)
    if (!circuitTrace) {
      throw new Error(
        `Raw keepout DRC requires Circuit JSON trace "${trace.pcb_trace_id}"`,
      )
    }
    if (typeof circuitTrace.source_trace_id !== "string") {
      throw new Error(
        `Raw keepout DRC requires source_trace_id for "${trace.pcb_trace_id}"`,
      )
    }
    const { obstacle, obstacleIndex } = keepouts[violation.obstacleIndex]!
    const keepoutId = obstacle.obstacleId!
    const errorId = `raw_keepout_${JSON.stringify([
      trace.pcb_trace_id,
      obstacleIndex,
      violation.kind,
    ])}`
    if (
      (errorsByPair.get(errorId)?.severity ?? -Infinity) >= violation.severity
    )
      continue
    errorsByPair.set(errorId, {
      severity: violation.severity,
      error: {
        type: "pcb_trace_error",
        error_type: "pcb_trace_error",
        pcb_trace_error_id: errorId,
        pcb_trace_id: trace.pcb_trace_id,
        source_trace_id: circuitTrace.source_trace_id,
        pcb_keepout_id: keepoutId,
        pcb_component_ids: [],
        pcb_port_ids: [],
        center: violation.center,
        minimum_clearance: 0,
        actual_clearance: -violation.severity,
        message: `Trace "${trace.pcb_trace_id}" ${violation.kind} copper overlaps pcb_keepout "${keepoutId}"`,
      },
    })
  }
  return [...errorsByPair.values()]
    .map(({ error }) => error)
    .sort((left, right) =>
      left.pcb_trace_error_id.localeCompare(right.pcb_trace_error_id),
    )
}
