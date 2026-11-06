import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import type { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"

export function getStmp157CompletedMeshSnapshotSvg(
  solver: TopologyMergingSolver,
): string {
  const view = { minX: -18, maxX: -16, minY: -9, maxY: -7.5 }
  const nodes = solver.getOutput()
  const rects: NonNullable<GraphicsObject["rects"]> = []
  const lines: NonNullable<GraphicsObject["lines"]> = []
  for (const node of nodes) {
    if (!node.availableZ.includes(0)) continue
    const minX = Math.max(view.minX, node.center.x - node.width / 2)
    const maxX = Math.min(view.maxX, node.center.x + node.width / 2)
    const minY = Math.max(view.minY, node.center.y - node.height / 2)
    const maxY = Math.min(view.maxY, node.center.y + node.height / 2)
    if (minX >= maxX || minY >= maxY) continue
    const stroke = node._containsObstacle ? "#bf7373" : "#4c7897"
    rects.push({
      ...createRectFromCapacityNode(node),
      // Draw the exact completed bounds; only the picture is cropped.
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      width: maxX - minX,
      height: maxY - minY,
      layer: "z0",
      stroke,
      label: undefined,
    })
    lines.push({
      points: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
        { x: minX, y: minY },
      ],
      strokeColor: stroke,
      strokeWidth: 0.0016,
    })
  }
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    rects,
    lines,
    texts: [
      {
        x: view.minX,
        y: view.maxY + 0.24,
        text: "STM32MP157 DDR · completed topology · top layer",
        fontSize: 0.044,
        anchorSide: "center_left",
      },
      {
        x: view.minX,
        y: view.maxY + 0.16,
        text: `${nodes.length} output regions · ${solver.stats.processedXSlabCount}/${solver.stats.xSlabCount} X slabs`,
        fontSize: 0.036,
        anchorSide: "center_left",
      },
      {
        x: view.minX,
        y: view.maxY + 0.08,
        text: `Retained scratch: ${solver["atomicRegions"].length} cells / ${solver["preparedNodes"].length} prepared nodes`,
        fontSize: 0.036,
        anchorSide: "center_left",
      },
      {
        x: view.minX,
        y: view.minY - 0.08,
        text: `${rects.length} top-layer regions in this 2 × 1.5 mm RAM-area view`,
        fontSize: 0.032,
        anchorSide: "center_left",
      },
    ],
  }
  return getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    svgWidth: 1200,
    svgHeight: 1000,
  })
}
