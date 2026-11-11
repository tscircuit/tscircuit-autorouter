import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"

/** Draw a top-layer CPU escape crop of the completed, unchanged full mesh. */
export function getA64EdgeLookupSvg({
  nodes,
  edges,
}: {
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
}): string {
  const visibleNodes = nodes.filter(
    (node) =>
      node.availableZ.includes(0) &&
      node.center.x >= 0 &&
      node.center.x <= 2 &&
      node.center.y >= -12 &&
      node.center.y <= -10,
  )
  const visibleNodeById = new Map<CapacityMeshNodeId, CapacityMeshNode>(
    visibleNodes.map((node) => [node.capacityMeshNodeId, node]),
  )
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    rects: visibleNodes.map((node) =>
      createRectFromCapacityNode(node, { rectMargin: 0.0001, zOffset: 0 }),
    ),
    lines: [],
  }
  for (const edge of edges) {
    const start = visibleNodeById.get(edge.nodeIds[0])
    const end = visibleNodeById.get(edge.nodeIds[1])
    if (!start || !end) continue
    graphics.lines!.push({ points: [start.center, end.center] })
  }
  return getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    svgWidth: 1100,
    svgHeight: 1100,
    includeTextLabels: false,
  })
}
