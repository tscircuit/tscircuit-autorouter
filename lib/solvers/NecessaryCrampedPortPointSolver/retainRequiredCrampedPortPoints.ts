import { pointToBoxDistance } from "@tscircuit/math-utils"
import type {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteJson,
} from "lib/types"
import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { getConnectionEscapePortPoints } from "../AvailableSegmentPointSolver/getConnectionEscapePortPoints"

/** Pruning local crossings must preserve complete terminal escapes. */
export function retainRequiredCrampedPortPoints({
  nodes,
  originalSegments,
  filteredSegments,
  connections,
}: {
  nodes: CapacityMeshNode[]
  originalSegments: SharedEdgeSegment[]
  filteredSegments: SharedEdgeSegment[]
  connections: SimpleRouteJson["connections"]
}): SharedEdgeSegment[] {
  const nodeMap = new Map(nodes.map((node) => [node.capacityMeshNodeId, node]))
  const originalPorts = new Map<CapacityMeshNodeId, SegmentPortPoint[]>()
  const retainedPorts = new Map<CapacityMeshNodeId, SegmentPortPoint[]>()
  for (const segment of originalSegments) {
    for (const port of segment.portPoints) {
      for (const nodeId of port.nodeIds) {
        if (!originalPorts.has(nodeId)) originalPorts.set(nodeId, [])
        originalPorts.get(nodeId)!.push(port)
      }
    }
  }
  for (const segment of filteredSegments) {
    for (const port of segment.portPoints) {
      // These crossings already survive pruning, including component-local
      // crossings and penalized multilayer escapes.
      const retainedPort = { ...port, cramped: false }
      for (const nodeId of port.nodeIds) {
        if (!retainedPorts.has(nodeId)) retainedPorts.set(nodeId, [])
        retainedPorts.get(nodeId)!.push(retainedPort)
      }
    }
  }

  const requiredPorts = new Set<SegmentPortPoint>()
  const endpoints = connections.flatMap(
    (connection) => connection.pointsToConnect,
  )
  for (const target of nodes) {
    if (
      !target._containsTarget ||
      target._isComponentTopologyNode ||
      !endpoints.some((point) => pointToBoxDistance(point, target) <= 1e-9)
    ) {
      continue
    }
    const escapeInput = { target, nodes, nodeMap, connections }
    const retainedEscape = getConnectionEscapePortPoints({
      ...escapeInput,
      portsByNodeId: retainedPorts,
    })
    if (retainedEscape) continue
    const originalEscape = getConnectionEscapePortPoints({
      ...escapeInput,
      portsByNodeId: originalPorts,
      allowCrampedPortPoints: true,
    })
    if (!originalEscape) continue
    for (const port of originalEscape) {
      if (!port.cramped) continue
      requiredPorts.add(port)
      for (const nodeId of port.nodeIds) {
        if (!retainedPorts.has(nodeId)) retainedPorts.set(nodeId, [])
        retainedPorts.get(nodeId)!.push({ ...port, cramped: false })
      }
    }
  }

  const originalSegmentByEdgeId = new Map(
    originalSegments.map((segment) => [segment.edgeId, segment]),
  )
  return filteredSegments.map((segment) => {
    const retainedIds = new Set(
      segment.portPoints.map((port) => port.segmentPortPointId),
    )
    const missingPorts = originalSegmentByEdgeId
      .get(segment.edgeId)!
      .portPoints.filter(
        (port) =>
          requiredPorts.has(port) && !retainedIds.has(port.segmentPortPointId),
      )
    if (missingPorts.length === 0) return segment
    return { ...segment, portPoints: [...segment.portPoints, ...missingPorts] }
  })
}
