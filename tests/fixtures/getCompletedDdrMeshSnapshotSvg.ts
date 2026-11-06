import type { Bounds } from "@tscircuit/math-utils"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import type { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"

type CompletedDdrMeshView = {
  solver: TopologyMergingSolver
  boardName: string
  view: Bounds
  outlineRegions?: boolean
}

export function getCompletedDdrMeshSnapshotSvg({
  solver,
  boardName,
  view,
  outlineRegions,
}: CompletedDdrMeshView): string {
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
      // Project the completed regions onto the top layer at their exact bounds.
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      width: maxX - minX,
      height: maxY - minY,
      layer: "z0",
      stroke,
      label: undefined,
    })
    if (outlineRegions) {
      // Explicit edges keep narrow boundaries visible in the detail views.
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
  }
  const rowHeight = (view.maxX - view.minX) * 0.04
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    rects,
    lines,
    texts: [
      {
        x: view.minX,
        y: view.maxY + rowHeight * 3,
        text: `${boardName} · completed topology · top layer`,
        fontSize: rowHeight * 0.55,
        anchorSide: "center_left",
      },
      {
        x: view.minX,
        y: view.maxY + rowHeight * 2,
        text: `${nodes.length} output regions · ${solver.stats.processedXSlabCount}/${solver.stats.xSlabCount} X slabs`,
        fontSize: rowHeight * 0.45,
        anchorSide: "center_left",
      },
      {
        x: view.minX,
        y: view.maxY + rowHeight,
        text: `Retained scratch: ${solver["atomicRegions"].length} cells / ${solver["preparedNodes"].length} prepared nodes`,
        fontSize: rowHeight * 0.45,
        anchorSide: "center_left",
      },
      {
        x: view.minX,
        y: view.minY - rowHeight,
        text: `${rects.length} top-layer regions in view · x ${view.minX.toFixed(2)}…${view.maxX.toFixed(2)}, y ${view.minY.toFixed(2)}…${view.maxY.toFixed(2)} mm`,
        fontSize: rowHeight * 0.4,
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
