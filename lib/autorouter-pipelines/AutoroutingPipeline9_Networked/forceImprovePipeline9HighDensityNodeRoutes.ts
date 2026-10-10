import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { materializePipeline9HdRouteVias } from "../AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { simplifyPipeline9CollinearRoutePoints } from "../AutoroutingPipeline9_PreloadedTraceGraph/simplifyPipeline9CollinearRoutePoints"

type ForceImprovePipeline9HighDensityNodeRoutesParams = {
  nodeWithPortPoints: NodeWithPortPoints
  hdRoutes: HighDensityIntraNodeRoute[]
  colorMap: Record<string, string>
  totalStepsPerNode: number
  nodeAssignmentMargin: number
  preserveTerminalPcbPortIds: boolean
}

/** Runs the existing independent force-improvement work before returning a node. */
export function forceImprovePipeline9HighDensityNodeRoutes({
  nodeWithPortPoints,
  hdRoutes,
  colorMap,
  totalStepsPerNode,
  nodeAssignmentMargin,
  preserveTerminalPcbPortIds,
}: ForceImprovePipeline9HighDensityNodeRoutesParams): HighDensityIntraNodeRoute[] {
  const restoredRoutes = hdRoutes.map((route): HighDensityIntraNodeRoute => {
    // A missing region uses board-wide containment to assign the force group.
    // Only explicit ownership makes the single-node solve equivalent.
    if (route.regionId !== nodeWithPortPoints.capacityMeshNodeId) {
      throw new Error(
        `Pipeline9 networked force-improvement route "${route.connectionName}" does not belong to node "${nodeWithPortPoints.capacityMeshNodeId}"`,
      )
    }
    const start = route.route[0]
    const end = route.route.at(-1)
    const connectionPortPoints = nodeWithPortPoints.portPoints.filter(
      (point) => point.connectionName === route.connectionName,
    )
    const startTerminal = connectionPortPoints.find(
      (point) =>
        point.pcb_port_id !== undefined &&
        start !== undefined &&
        point.x === start.x &&
        point.y === start.y &&
        point.z === start.z,
    )
    const endTerminal = connectionPortPoints.find(
      (point) =>
        point.pcb_port_id !== undefined &&
        end !== undefined &&
        point.x === end.x &&
        point.y === end.y &&
        point.z === end.z,
    )
    return {
      ...route,
      rootConnectionName:
        connectionPortPoints[0]?.rootConnectionName ?? route.rootConnectionName,
      ...(preserveTerminalPcbPortIds
        ? {
            startPcbPortId: startTerminal?.pcb_port_id,
            endPcbPortId: endTerminal?.pcb_port_id,
          }
        : {}),
    }
  })
  const solver = new HighDensityForceImproveSolver({
    nodeWithPortPoints: [nodeWithPortPoints],
    hdRoutes: simplifyPipeline9CollinearRoutePoints(
      materializePipeline9HdRouteVias(restoredRoutes),
    ),
    colorMap,
    totalStepsPerNode,
    nodeAssignmentMargin,
  })
  solver.solve()
  if (!solver.solved) {
    throw new Error(
      `Pipeline9 force improvement failed for node "${nodeWithPortPoints.capacityMeshNodeId}": ${solver.error}`,
    )
  }
  return solver.getOutput()
}
