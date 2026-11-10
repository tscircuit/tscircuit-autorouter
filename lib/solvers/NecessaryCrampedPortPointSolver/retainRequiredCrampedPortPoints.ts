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
import { getConnectionEscapeIndex } from "../AvailableSegmentPointSolver/getConnectionEscapeIndex"
import { getConnectionEscapePortPoints } from "../AvailableSegmentPointSolver/getConnectionEscapePortPoints"

function getPortPointsByNodeId({
  segments,
  arePortsRetained,
}: {
  segments: SharedEdgeSegment[]
  arePortsRetained: boolean
}): Map<CapacityMeshNodeId, SegmentPortPoint[]> {
  const portsByNodeId = new Map<CapacityMeshNodeId, SegmentPortPoint[]>()
  for (const segment of segments) {
    for (const port of segment.portPoints) {
      let indexedPort = port
      if (arePortsRetained && port.cramped) {
        indexedPort = { ...port, cramped: false }
      }
      for (const nodeId of port.nodeIds) {
        if (!portsByNodeId.has(nodeId)) portsByNodeId.set(nodeId, [])
        portsByNodeId.get(nodeId)!.push(indexedPort)
      }
    }
  }
  return portsByNodeId
}

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
  let originalPorts: Map<CapacityMeshNodeId, SegmentPortPoint[]> | undefined
  const retainedPorts = getPortPointsByNodeId({
    segments: filteredSegments,
    arePortsRetained: true,
  })
  const escapeIndex = getConnectionEscapeIndex({
    nodes,
    nodeMap,
    portsByNodeId: retainedPorts,
  })

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
    const escapeInput = { target, nodes, nodeMap, connections, escapeIndex }
    const retainedEscape = getConnectionEscapePortPoints({
      ...escapeInput,
      portsByNodeId: retainedPorts,
    })
    if (retainedEscape) continue
    if (!originalPorts) {
      originalPorts = getPortPointsByNodeId({
        segments: originalSegments,
        arePortsRetained: false,
      })
    }
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

  if (requiredPorts.size === 0) return filteredSegments
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
