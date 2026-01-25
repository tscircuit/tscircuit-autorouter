import type { GraphicsObject } from "graphics-debug"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  CapacityPath,
} from "../../types"
import type { NodePortSegment } from "../../types/capacity-edges-to-port-segments-types"
import { BaseSolver } from "../BaseSolver"
import { getNodeEdgeMap } from "./getNodeEdgeMap"
import { safeTransparentize } from "../colors"

/**
 * Each Node is a square. The capacity paths indicate the nodes the trace will
 * travel through. We want to find the "Port Segment" that each capacity path
 * will take for each node.
 */
export class CapacityEdgeToPortSegmentSolver extends BaseSolver {
  override getSolverName(): string {
    return "CapacityEdgeToPortSegmentSolver"
  }

  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
  capacityPaths: CapacityPath[]

  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  nodeEdgeMap: Map<CapacityMeshNodeId, CapacityMeshEdge[]>

  unprocessedNodeIds: CapacityMeshNodeId[]

  nodePortSegments: Map<CapacityMeshNodeId, NodePortSegment[]>
  colorMap: Record<string, string>

  constructor({
    nodes,
    edges,
    capacityPaths,
    colorMap,
  }: {
    nodes: CapacityMeshNode[]
    edges: CapacityMeshEdge[]
    capacityPaths: CapacityPath[]
    colorMap?: Record<string, string>
  }) {
    super()
    this.nodes = nodes
    this.edges = edges
    this.nodeMap = new Map(nodes.map((node) => [node.capacityMeshNodeId, node]))
    this.nodeEdgeMap = getNodeEdgeMap(edges)
    this.capacityPaths = capacityPaths
    this.colorMap = colorMap ?? {}

    // We will be evaluating capacity paths
    this.unprocessedNodeIds = [
      ...new Set(capacityPaths.flatMap((path) => path.nodeIds)),
    ]
    this.nodePortSegments = new Map()
  }

  step() {
    const nodeId = this.unprocessedNodeIds.pop()
    if (!nodeId) {
      this.solved = true
      return
    }

    const pathsGoingThroughNode: Array<{
      path: CapacityPath
      indexOfNodeInPath: number
    }> = []
    for (const path of this.capacityPaths) {
      const indexOfNodeInPath = path.nodeIds.indexOf(nodeId)
      if (indexOfNodeInPath !== -1) {
        pathsGoingThroughNode.push({ path, indexOfNodeInPath })
      }
    }

    const node = this.nodeMap.get(nodeId)!
    const nodePortSegments: NodePortSegment[] = []

    for (const { path, indexOfNodeInPath } of pathsGoingThroughNode) {
      const entryNodeId = path.nodeIds[indexOfNodeInPath - 1]
      const exitNodeId = path.nodeIds[indexOfNodeInPath + 1]

      for (const adjNodeId of [entryNodeId, exitNodeId]) {
        const adjNode = this.nodeMap.get(adjNodeId)!
        if (!adjNode) continue
        const segment = findOverlappingSegment(node, adjNode)

        const mutuallyAvailableZ = adjNode.availableZ.filter((z) =>
          node.availableZ.includes(z),
        )

        if (mutuallyAvailableZ.length === 0) continue

        const portSegment: NodePortSegment = {
          capacityMeshNodeId: nodeId,
          start: segment.start,
          end: segment.end,
          connectionNames: [path.connectionName],
          rootConnectionNames: path.rootConnectionName
            ? [path.rootConnectionName]
            : undefined,
          availableZ: mutuallyAvailableZ,
        }

        nodePortSegments.push(portSegment)
      }
    }

    // Combine overlapping or adjacent segments on the same edge.
    const combinedSegments = combineSegments(nodePortSegments)
    this.nodePortSegments.set(nodeId, combinedSegments)
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }
    this.nodePortSegments.forEach((segments, nodeId) => {
      const node = this.nodeMap.get(nodeId)!
      segments.forEach((segment) => {
        const isVertical = segment.start.x === segment.end.x
        const THICKNESS = 0.05
        for (let i = 0; i < segment.connectionNames.length; i++) {
          const offset = {
            x: 0.05 * Math.max(...segment.availableZ),
            y: 0.05 * Math.max(...segment.availableZ),
          }
          const trueSegmentCenter = {
            x: (segment.start.x + segment.end.x) / 2,
            y: (segment.start.y + segment.end.y) / 2,
          }
          const segmentCenter = {
            x: trueSegmentCenter.x + offset.x,
            y: trueSegmentCenter.y + offset.y,
          }
          if (offset.x > 0) {
            // small dashed line to show the true center
            graphics.lines!.push({
              points: [trueSegmentCenter, segmentCenter],
              strokeColor: "rgba(0, 0, 0, 0.25)",
              strokeDash: "5 5",
            })
          }
          graphics.points!.push({
            x: segmentCenter.x,
            y: segmentCenter.y,
            label: `${nodeId}: ${segment.connectionNames.join(", ")}\navailableZ: ${segment.availableZ.join(",")}\nnodePortSegmentId: ${segment.nodePortSegmentId!}`,
          })
          graphics.lines!.push({
            points: [segment.start, segment.end],
            strokeColor: safeTransparentize(
              this.colorMap[segment.connectionNames[i]],
              0.6,
            ),
          })
        }
      })
    })
    return graphics
  }
}

function findOverlappingSegment(
  node: CapacityMeshNode,
  adjNode: CapacityMeshNode,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  // Find overlapping ranges in x and y dimensions
  const xOverlap = {
    start: Math.max(
      node.center.x - node.width / 2,
      adjNode.center.x - adjNode.width / 2,
    ),
    end: Math.min(
      node.center.x + node.width / 2,
      adjNode.center.x + adjNode.width / 2,
    ),
  }

  const yOverlap = {
    start: Math.max(
      node.center.y - node.height / 2,
      adjNode.center.y - adjNode.height / 2,
    ),
    end: Math.min(
      node.center.y + node.height / 2,
      adjNode.center.y + adjNode.height / 2,
    ),
  }

  const xRange = xOverlap.end - xOverlap.start
  const yRange = yOverlap.end - yOverlap.start

  // If the x-range is smaller then the nodes touch vertically (common vertical edge).
  if (xRange < yRange) {
    // They are horizontally adjacent: shared vertical edge.
    const x = (xOverlap.start + xOverlap.end) / 2
    return {
      start: { x, y: yOverlap.start },
      end: { x, y: yOverlap.end },
    }
  } else {
    // Otherwise, they are vertically adjacent: shared horizontal edge.
    const y = (yOverlap.start + yOverlap.end) / 2
    return {
      start: { x: xOverlap.start, y },
      end: { x: xOverlap.end, y },
    }
  }
}

const EPSILON = 1e-9 // Adjust threshold as needed

function coordsAreEqual(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): boolean {
  return Math.abs(p1.x - p2.x) < EPSILON && Math.abs(p1.y - p2.y) < EPSILON
}

// Helper to compare availableZ arrays (order matters for equality check here)
function availableZAreEqual(zA1: number[], zA2: number[]): boolean {
  if (zA1.length !== zA2.length) {
    return false
  }
  // Assuming they are sorted or order matters for distinction
  for (let i = 0; i < zA1.length; i++) {
    if (zA1[i] !== zA2[i]) {
      return false
    }
  }
  return true
}

/**
 * Given a list of segments on a node, merge segments that are geometrically
 * identical (same start/end points, potentially swapped) AND share the exact
 * same availableZ list. Combines only their connection names.
 */
function combineSegments(segments: NodePortSegment[]): NodePortSegment[] {
  const mergedSegments: NodePortSegment[] = []
  // Create copies to avoid modifying the original array during iteration
  // Sort availableZ consistently within each segment copy first
  const remainingSegments = segments.map((s) => ({
    ...s,
    connectionNames: [...s.connectionNames],
    rootConnectionNames: s.rootConnectionNames
      ? [...s.rootConnectionNames]
      : [],
    availableZ: [...s.availableZ].sort((a, b) => a - b), // Ensure Z is sorted for comparison
  }))

  while (remainingSegments.length > 0) {
    const segmentUnderTest = remainingSegments.pop()!
    let foundMatch = false

    for (let i = 0; i < mergedSegments.length; i++) {
      const mergedSegment = mergedSegments[i]

      // Check 1: Geometric match (allowing for start/end swap)
      const geometryMatch =
        (coordsAreEqual(mergedSegment.start, segmentUnderTest.start) &&
          coordsAreEqual(mergedSegment.end, segmentUnderTest.end)) ||
        (coordsAreEqual(mergedSegment.start, segmentUnderTest.end) &&
          coordsAreEqual(mergedSegment.end, segmentUnderTest.start))

      // Check 2: availableZ match
      const zMatch = availableZAreEqual(
        mergedSegment.availableZ,
        segmentUnderTest.availableZ,
      )

      if (geometryMatch && zMatch) {
        // --- Merge Logic ---
        // Combine connection names (ensuring uniqueness)
        const currentConnections = new Set(mergedSegment.connectionNames)
        segmentUnderTest.connectionNames.forEach((cn) =>
          currentConnections.add(cn),
        )
        mergedSegment.connectionNames = Array.from(currentConnections)

        // Combine root connection names
        const currentRootConnectionNames = new Set(
          mergedSegment.rootConnectionNames || [],
        )
        segmentUnderTest.rootConnectionNames?.forEach((id) =>
          currentRootConnectionNames.add(id),
        )
        mergedSegment.rootConnectionNames = Array.from(
          currentRootConnectionNames,
        )

        // DO NOT merge availableZ - they must be identical to reach here.

        foundMatch = true
        break // Found a match for segmentUnderTest, move to next remaining
      }
    }

    if (!foundMatch) {
      // If no suitable match was found (different geometry OR different availableZ),
      // add the segmentUnderTest as a new distinct merged segment.
      mergedSegments.push(segmentUnderTest)
    }
  }
  return mergedSegments
}
