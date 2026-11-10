import { getConnectionEscapePortPoints } from "./getConnectionEscapePortPoints"
import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types"
import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "./AvailableSegmentPointSolver"
import { SingleTargetNecessaryCrampedPortPointSolver } from "../NecessaryCrampedPortPointSolver/SingleTargetNecessaryCrampedPortPointSolver"
import { isAllCandidatesBlockedByObstacles } from "../NecessaryCrampedPortPointSolver/isAllCandidatesBlockedByObstacles"

/** Keep numerical bridges that participate in an active terminal escape. */
export function retainActiveNumericalGapSegments({
  segments,
  nodes,
  connections,
}: {
  segments: SharedEdgeSegment[]
  nodes: CapacityMeshNode[]
  connections: SimpleRouteConnection[]
}): SharedEdgeSegment[] {
  const neighbors = new Map<string, Set<string>>()
  for (const segment of segments) {
    if (!segment.crossesNumericalGap) continue
    const [first, second] = segment.nodeIds
    if (!neighbors.has(first)) neighbors.set(first, new Set())
    if (!neighbors.has(second)) neighbors.set(second, new Set())
    neighbors.get(first)!.add(second)
    neighbors.get(second)!.add(first)
  }
  if (neighbors.size === 0) return segments

  // _containsTarget also marks completed copper. Only actual connection
  // endpoints need new escapes; inactive copper must not add routing shortcuts.
  const endpoints = connections.flatMap(
    (connection) => connection.pointsToConnect,
  )
  const nodeMap = new Map(nodes.map((node) => [node.capacityMeshNodeId, node]))
  const ordinaryPorts = new Map<string, SegmentPortPoint[]>()
  for (const segment of segments) {
    if (segment.crossesNumericalGap) continue
    for (const port of segment.portPoints) {
      // Component topology deliberately retains its cramped crossings. Count
      // those planned paths as existing escapes, as the pipeline does.
      const escapePort =
        port.cramped &&
        port.nodeIds.some(
          (nodeId) => nodeMap.get(nodeId)!._isComponentTopologyNode,
        )
          ? { ...port, cramped: false }
          : port
      for (const nodeId of port.nodeIds) {
        if (!ordinaryPorts.has(nodeId)) ordinaryPorts.set(nodeId, [])
        ordinaryPorts.get(nodeId)!.push(escapePort)
      }
    }
  }
  const reached = new Set<string>()
  for (const node of nodes) {
    if (!node._containsTarget || !neighbors.has(node.capacityMeshNodeId))
      continue
    if (
      endpoints.some(
        (point) =>
          Math.abs(point.x - node.center.x) <= node.width / 2 &&
          Math.abs(point.y - node.center.y) <= node.height / 2,
      )
    ) {
      // Nearby free space may be a closed pocket. Retain a numerical bridge
      // unless ordinary ports can also reach the connection's destinations.
      const escape = new SingleTargetNecessaryCrampedPortPointSolver({
        target: node,
        depthLimit: 2,
        shouldIgnoreCrampedPortPoints: true,
        mapOfCapacityMeshNodeIdToSegmentPortPoints: ordinaryPorts,
        mapOfCapacityMeshNodeIdToRef: nodeMap,
      })
      escape.solve()
      if (escape.failed)
        throw new Error(escape.error ?? "Terminal escape analysis failed")
      if (
        isAllCandidatesBlockedByObstacles({
          candidates: escape.getOutput(),
          mapOfCapacityMeshNodeIdToRef: nodeMap,
        }) ||
        (!node._isComponentTopologyNode &&
          !getConnectionEscapePortPoints({
            target: node,
            nodes,
            nodeMap,
            portsByNodeId: ordinaryPorts,
            connections,
          }))
      ) {
        reached.add(node.capacityMeshNodeId)
      }
    }
  }

  // An escape may cross several discarded slivers before reaching ordinary
  // free space. Retain the whole numerical-gap component, not just pad edges.
  const queue = [...reached]
  for (let index = 0; index < queue.length; index++) {
    for (const neighbor of neighbors.get(queue[index]!)!) {
      if (reached.has(neighbor)) continue
      reached.add(neighbor)
      queue.push(neighbor)
    }
  }

  return segments
    .filter(
      (segment) =>
        !segment.crossesNumericalGap ||
        segment.nodeIds.some((nodeId) => reached.has(nodeId)),
    )
    .map((segment) =>
      segment.crossesNumericalGap
        ? { ...segment, isActiveTerminalEscape: true }
        : segment,
    )
}
