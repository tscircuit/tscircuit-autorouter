import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { AnyCircuitElement, PcbTraceError } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { isOpaqueUnownedObstacle } from "lib/utils/isOpaqueUnownedObstacle"

type UnownedObstacleDrcError = PcbTraceError & {
  center: { x: number; y: number }
  srj_obstacle_id?: string
  srj_obstacle_index: number
  minimum_clearance: number
  actual_clearance: number
}

/** Check copper overlap with opaque unowned SRJ barriers omitted by Circuit JSON. */
export const getUnownedObstacleDrcErrors = ({
  inputSrj,
  jointTraces,
  circuitJson,
}: {
  inputSrj: SimpleRouteJson
  jointTraces: SimplifiedPcbTrace[]
  circuitJson: AnyCircuitElement[]
}): UnownedObstacleDrcError[] => {
  // Completed fanout footprint bounds reserve later routing space while their
  // existing source copper remains represented by traces inside the footprint.
  const unownedObstacles = inputSrj.obstacles.flatMap((obstacle, obstacleIndex) =>
    isOpaqueUnownedObstacle(obstacle) && obstacle.isFanoutSourceKeepout !== true
      ? [{ obstacle, obstacleIndex }]
      : [],
  )
  if (unownedObstacles.length === 0) return []
  const barrierSrj = createSrjWithBoardValidObstacleLayers({
    ...inputSrj,
    obstacles: unownedObstacles.map(({ obstacle }) => obstacle),
  })

  // These barriers have no electrical owner, so aliases cannot exempt copper.
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
      ...barrierSrj,
      traces: undefined,
      // Routing margins do not declare additional clearance for opaque barriers.
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
    { severity: number; error: UnownedObstacleDrcError }
  >()
  for (const violation of violations) {
    const route = routes[violation.routeIndex]!
    const trace = jointTraces[route.preloadedTraceIndex]!
    const circuitTrace = circuitTracesById.get(trace.pcb_trace_id)
    if (!circuitTrace) {
      throw new Error(
        `Unowned obstacle DRC requires Circuit JSON trace "${trace.pcb_trace_id}"`,
      )
    }
    if (typeof circuitTrace.source_trace_id !== "string") {
      throw new Error(
        `Unowned obstacle DRC requires source_trace_id for "${trace.pcb_trace_id}"`,
      )
    }
    const { obstacle, obstacleIndex } = unownedObstacles[violation.obstacleIndex]!
    const errorId = `unowned_obstacle_${JSON.stringify([
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
        ...(obstacle.obstacleId !== undefined
          ? { srj_obstacle_id: obstacle.obstacleId }
          : {}),
        srj_obstacle_index: obstacleIndex,
        pcb_component_ids: [],
        pcb_port_ids: [],
        center: violation.center,
        minimum_clearance: 0,
        actual_clearance: -violation.severity,
        message: `Trace "${trace.pcb_trace_id}" ${violation.kind} copper overlaps unowned SRJ obstacle ${obstacleIndex}`,
      },
    })
  }
  return [...errorsByPair.values()]
    .map(({ error }) => error)
    .sort((left, right) =>
      left.pcb_trace_error_id.localeCompare(right.pcb_trace_error_id),
    )
}
