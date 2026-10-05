import { GraphicsObject } from "graphics-debug"
import {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "lib/types"
import { safeTransparentize } from "../colors" // Added import
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { getLinesBetweenNodes } from "lib/utils/getLinesBetweenNodes"
import { calculateNodeProbabilityOfFailure } from "./computeSectionScore"

interface VisualizeSectionParams {
  sectionNodes: CapacityMeshNode[]
  sectionEdges: CapacityMeshEdge[] // Edges *only* within the section
  sectionConnectionTerminals: Array<{
    connectionName: string
    startNodeId: CapacityMeshNodeId
    endNodeId: CapacityMeshNodeId
    path?: CapacityMeshNode[] // Optional path for terminals
  }>
  completedPaths?: Array<{
    // Optional array for explicitly drawing completed paths
    connectionName: string
    path: CapacityMeshNode[]
  }>
  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode> // Map for all relevant nodes (section + potentially neighbors if needed for edges)
  colorMap: Record<string, string>
  centerNodeId?: CapacityMeshNodeId | null // Optional: for highlighting the center
  title: string // Custom title for the visualization
  nodeOpacity?: number
  usedNodeCapacityMap?: Map<CapacityMeshNodeId, number> // Optional capacity map
  totalCapacityMap?: Map<CapacityMeshNodeId, number> // Optional capacity map
}

export function visualizeSection({
  sectionNodes,
  sectionEdges,
  sectionConnectionTerminals,
  completedPaths, // Added completedPaths
  nodeMap,
  colorMap,
  centerNodeId,
  title,
  nodeOpacity = 0.1,
  usedNodeCapacityMap, // Destructure added params
  totalCapacityMap, // Destructure added params
}: VisualizeSectionParams): GraphicsObject {
  const graphics: GraphicsObject = {
    points: [],
    lines: [],
    rects: [],
    circles: [],
    title: title,
  }

  const sectionNodeIds = new Set(sectionNodes.map((n) => n.capacityMeshNodeId))

  // Highlight all nodes in the section
  for (const node of sectionNodes) {
    let nodeFill = `rgba(128, 128, 128, ${nodeOpacity})` // Default gray
    let nodeStroke = `rgba(128, 128, 128, ${nodeOpacity})` // Default gray stroke

    const availableZ = node.availableZ ?? []
    const hasZ0 = availableZ.includes(0)
    const hasZ1 = availableZ.includes(1)

    if (hasZ0 && hasZ1) {
      nodeFill = `rgba(128, 0, 128, ${nodeOpacity})` // Purple fill
      nodeStroke = `rgba(128, 0, 128, ${nodeOpacity})` // Purple stroke
    } else if (hasZ0) {
      nodeFill = `rgba(0, 0, 255, ${nodeOpacity})` // Blue fill
      nodeStroke = `rgba(0, 0, 255, ${nodeOpacity})` // Blue stroke
    } else if (hasZ1) {
      nodeFill = `rgba(255, 0, 0, ${nodeOpacity})` // Red fill
      nodeStroke = `rgba(255, 0, 0, ${nodeOpacity})` // Red stroke
    }

    // Override for center node if provided
    if (centerNodeId && node.capacityMeshNodeId === centerNodeId) {
      nodeFill = `rgba(0, 255, 0, ${nodeOpacity})` // Center node green fill
      nodeStroke = `rgba(0, 128, 0, ${nodeOpacity})` // Center node green stroke (using standard green RGB)
    }

    graphics.rects!.push({
      ...createRectFromCapacityNode(node),
      fill: nodeFill,
      stroke: nodeStroke,
      label: `${node.capacityMeshNodeId}\n(Section Node)\nZ: ${availableZ.join(",")}`,
    })

    // Add capacity info to label if maps are provided
    const rectIndex = graphics.rects!.length - 1
    if (usedNodeCapacityMap && totalCapacityMap) {
      const used = usedNodeCapacityMap.get(node.capacityMeshNodeId) ?? 0
      const total = totalCapacityMap.get(node.capacityMeshNodeId) ?? 0
      const percent = total > 0 ? ((used / total) * 100).toFixed(1) : "N/A"
      const probabilityOfFailure = calculateNodeProbabilityOfFailure({
        usedCapacity: used,
        totalCapacity: total,
        layerCount: node.availableZ.length,
      })
      graphics.rects![rectIndex].label += `\n${used.toFixed(
        1,
      )} / ${total.toFixed(1)}\n${percent}% (Pf: ${(
        probabilityOfFailure * 100
      ).toFixed(1)}%)`

      // Add stroke if probability of failure is > 0
      if (probabilityOfFailure > 0.2) {
        graphics.rects![rectIndex].stroke = safeTransparentize(
          "red",
          (0.8 + nodeOpacity) * 0.7,
        )
      }
    }
  }

  // Draw edges within the section
  for (const edge of sectionEdges) {
    const [nodeIdA, nodeIdB] = edge.nodeIds
    // Both nodes must be in the provided nodeMap to draw the edge
    const nodeA = nodeMap.get(nodeIdA)
    const nodeB = nodeMap.get(nodeIdB)
    if (nodeA && nodeB) {
      const { lineStart, lineEnd } = getLinesBetweenNodes(nodeA, nodeB)
      graphics.lines!.push({
        points: [lineStart, lineEnd],
        strokeColor: `rgba(0, 0, 0, ${0.2 * Math.min(1, nodeOpacity / 0.1)})`, // Light gray for intra-section edges
      })
    }
  }

  // Highlight connection terminals within the section
  sectionConnectionTerminals.forEach((terminal, index) => {
    const startNode = nodeMap.get(terminal.startNodeId)
    const endNode = nodeMap.get(terminal.endNodeId)
    const connectionColor = colorMap[terminal.connectionName] ?? "black" // Default to black if not found

    // Ensure terminals are actually within the visualized section nodes
    const isStartInSection =
      startNode && sectionNodeIds.has(startNode.capacityMeshNodeId)
    const isEndInSection =
      endNode && sectionNodeIds.has(endNode.capacityMeshNodeId)

    const offsetMultiplier = (index + index / 50) % 5 // Simple offset logic
    let startOffsetX = 0
    let startOffsetY = 0
    let endOffsetX = 0
    let endOffsetY = 0

    if (isStartInSection && startNode) {
      const baseOffset = 0.02 * Math.min(startNode.width, startNode.height)
      startOffsetX = baseOffset * offsetMultiplier
      startOffsetY = baseOffset * offsetMultiplier
      graphics.points!.push({
        x: startNode.center.x + startOffsetX,
        y: startNode.center.y + startOffsetY,
        color: connectionColor,
        label: `Start: ${terminal.connectionName}\n(${terminal.startNodeId})`,
      })
      graphics.lines!.push({
        points: [
          { x: startNode.center.x, y: startNode.center.y },
          {
            x: startNode.center.x + startOffsetX,
            y: startNode.center.y + startOffsetY,
          },
        ],
        strokeColor: "gray",
        strokeDash: "2 2",
      })
    }

    if (isEndInSection && endNode) {
      const baseOffset = 0.02 * Math.min(endNode.width, endNode.height)
      endOffsetX = baseOffset * offsetMultiplier
      endOffsetY = baseOffset * offsetMultiplier
      graphics.points!.push({
        x: endNode.center.x + endOffsetX,
        y: endNode.center.y + endOffsetY,
        color: connectionColor,
        label: `End: ${terminal.connectionName}\n(${terminal.endNodeId})`,
      })
      graphics.lines!.push({
        points: [
          { x: endNode.center.x, y: endNode.center.y },
          {
            x: endNode.center.x + endOffsetX,
            y: endNode.center.y + endOffsetY,
          },
        ],
        strokeColor: "gray",
        strokeDash: "2 2",
      })
    }

    // Draw a line between terminals only if both are within the section
    if (isStartInSection && isEndInSection && startNode && endNode) {
      graphics.lines!.push({
        points: [
          {
            x: startNode.center.x + startOffsetX,
            y: startNode.center.y + startOffsetY,
          },
          {
            x: endNode.center.x + endOffsetX,
            y: endNode.center.y + endOffsetY,
          },
        ],
        strokeColor: connectionColor,
        strokeDash: "5 5",
      })
    }
  })

  // Draw completed paths if provided
  if (completedPaths) {
    completedPaths.forEach((solvedPathData, index) => {
      if (solvedPathData.path && solvedPathData.path.length > 0) {
        const pathColor = colorMap[solvedPathData.connectionName] ?? "gray"
        const offset = {
          x: ((index + index / 50) % 5) * 0.03,
          y: ((index + index / 50) % 5) * 0.03,
        }
        graphics.lines!.push({
          points: solvedPathData.path.map(({ center: { x, y } }) => ({
            x: x + offset.x,
            y: y + offset.y,
          })),
          strokeColor: safeTransparentize(pathColor, 0.2), // Make solved paths semi-transparent
          // strokeWidth: 0.03,
        })
      }
    })
  }

  return graphics
}
