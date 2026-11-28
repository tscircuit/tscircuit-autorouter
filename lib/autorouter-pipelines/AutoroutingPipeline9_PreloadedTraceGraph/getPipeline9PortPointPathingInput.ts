import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { getAllowedZByConnectionName } from "./getAllowedZByConnectionName"
import { reservePreloadedCopperPorts } from "./reservePreloadedCopperPorts"
import { getExistingViaInPadByPcbPortId } from "lib/utils/getExistingViaInPadByPcbPortId"
import type { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "./AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

/** Build the pathing graph and reserve crossing ports occupied by preloaded copper. */
export function getPipeline9PortPointPathingInput(
  segmentPortPoints: SegmentPortPoint[],
  pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
): HgPortPointPathingSolverParams & { captureSearchDebug: boolean } {
  const pointPairConnections = pipeline.srjWithPointPairs!.connections
  const allowedZByConnectionName = getAllowedZByConnectionName(
    pipeline.originalSrj,
    pointPairConnections,
  )
  const everyConnectionRestricted =
    pointPairConnections.length > 0 &&
    pointPairConnections.every((conn) =>
      allowedZByConnectionName.has(conn.name),
    )
  const unionAllowedZ = everyConnectionRestricted
    ? new Set(
        pointPairConnections.flatMap((conn) => [
          ...(allowedZByConnectionName.get(conn.name) ?? []),
        ]),
      )
    : undefined
  const filteredSegmentPortPoints = unionAllowedZ
    ? segmentPortPoints.flatMap((spp) => {
        const availableZ = spp.availableZ.filter((z) => unionAllowedZ.has(z))
        return availableZ.length > 0 ? [{ ...spp, availableZ }] : []
      })
    : segmentPortPoints
  const filteredCapacityNodes =
    unionAllowedZ?.size === 1
      ? pipeline.capacityNodes!.map((node) => {
          const availableZ = node.availableZ.filter((z) => unionAllowedZ.has(z))
          return availableZ.length > 0 ? { ...node, availableZ } : node
        })
      : pipeline.capacityNodes!

  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes: filteredCapacityNodes,
    layerCount: pipeline.srj.layerCount,
    connectivityMap: pipeline.connMap,
    segmentPortPoints: filteredSegmentPortPoints,
    simpleRouteJsonConnections: pointPairConnections,
    existingViaInPadByPcbPortId: getExistingViaInPadByPcbPortId(
      pipeline.srjWithPointPairs!,
    ),
  })

  reservePreloadedCopperPorts({
    graph,
    srj: pipeline.srj,
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
    ...(allowedZByConnectionName.size > 0 ? { allowedZByConnectionName } : {}),
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
