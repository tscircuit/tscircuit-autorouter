import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { reservePreloadedCopperPorts } from "./reservePreloadedCopperPorts"
import { getExistingViaInPadByPcbPortId } from "lib/utils/getExistingViaInPadByPcbPortId"
import type { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "./AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

/** Build the pathing graph and reserve crossing ports occupied by preloaded copper. */
export function getPipeline9PortPointPathingInput(
  segmentPortPoints: SegmentPortPoint[],
  pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
): HgPortPointPathingSolverParams & { captureSearchDebug: boolean; minimumPortSpacing?: number } {
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes: pipeline.capacityNodes!,
    layerCount: pipeline.srj.layerCount,
    connectivityMap: pipeline.connMap,
    segmentPortPoints,
    simpleRouteJsonConnections: pipeline.srjWithPointPairs!.connections,
    existingViaInPadByPcbPortId: getExistingViaInPadByPcbPortId(
      pipeline.srjWithPointPairs!,
    ),
  })

  reservePreloadedCopperPorts({
    graph,
    srj: { ...pipeline.originalSrj, traces: pipeline.srj.traces },
    connMap: pipeline.connMap,
    traceWidth: pipeline.minTraceWidth,
    viaDiameter: pipeline.viaDiameter,
  })

  return {
    graph,
    connections,
    layerCount: pipeline.srj.layerCount,
    effort: Math.min(1, pipeline.effort),
    preserveTerminalPcbPortIds: true,
    captureSearchDebug: pipeline.opts.captureSearchDebug ?? false,
    minViaPadDiameter: pipeline.viaDiameter,
    minimumPortSpacing: pipeline.originalSrj.traces?.some((trace) => trace.isFixed)
      ? pipeline.minTraceWidth +
        (pipeline.originalSrj.minTraceToPadEdgeClearance ?? pipeline.originalSrj.defaultObstacleMargin ?? 0.1)
      : undefined,
    flags: {
      FORCE_CENTER_FIRST: true,
      RIPPING_ENABLED: true,
      USE_SELECTIVE_RERIP_ROUTING: true,
      USE_PREPARED_PORT_POINT_ROUTING: true,
      USE_PARTIAL_RIP_ROUTING_WITH_PRELOADED_TRACES: true,
    },
    weights: {
      SHUFFLE_SEED: 0,
      MEMORY_PF_FACTOR: 4,
      CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
      CENTER_OFFSET_FOCUS_SHIFT: 0,
      NODE_PF_FACTOR: 0,
      LAYER_CHANGE_COST: 0,
      RIPPING_PF_COST: 0.0,
      NODE_PF_MAX_PENALTY: 100,
      BASE_CANDIDATE_COST: 0.6,
      MAX_ITERATIONS_PER_PATH: 0,
      RANDOM_WALK_DISTANCE: 0,
      START_RIPPING_PF_THRESHOLD: 0.3,
      END_RIPPING_PF_THRESHOLD: 1,
      MAX_RIPS: 1000,
      RANDOM_RIP_FRACTION: 0.3,
      STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 4,
      GREEDY_MULTIPLIER: 0.7,
      MIN_ALLOWED_BOARD_SCORE: -10000,
    },
  }
}
