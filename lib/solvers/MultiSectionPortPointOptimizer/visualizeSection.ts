import type { GraphicsObject } from "graphics-debug"
import type { PortPointSection } from "./createPortPointSection"

/**
 * Creates a GraphicsObject visualization of a PortPointSection.
 * This draws nodes and port points in the same style as visualizePointPathSolver.
 */
export function visualizeSection(
  section: PortPointSection,
  colorMap?: Record<string, string>,
): GraphicsObject {
  const graphics: GraphicsObject = {
    lines: [],
    points: [],
    rects: [],
    circles: [],
  }

  // Draw nodes (same style as visualizePointPathSolver)
  for (const node of section.inputNodes) {
    const isCenter = node.capacityMeshNodeId === section.centerNodeId
    // Use green for center node, gray for others (no pf calculation in section view)
    const color = isCenter ? "rgba(0, 200, 0, 0.3)" : "rgba(200, 200, 200, 0.3)"

    graphics.rects!.push({
      center: node.center,
      width: node.width * 0.9,
      height: node.height * 0.9,
      layer: `z${node.availableZ.join(",")}`,
      fill: color,
      label: `${node.capacityMeshNodeId}${isCenter ? " (CENTER)" : ""}`,
    })
  }

  // Draw all input port points (same style as visualizePointPathSolver)
  for (const node of section.inputNodes) {
    for (const portPoint of node.portPoints) {
      // In section view, port points are unassigned so use gray
      const color = "rgba(150, 150, 150, 0.5)"

      graphics.circles!.push({
        center: { x: portPoint.x, y: portPoint.y },
        radius: 0.05,
        fill: color,
        layer: `z${portPoint.z}`,
        label: [
          portPoint.portPointId,
          `cd: ${portPoint.distToCentermostPortOnZ}`,
          `connects: ${portPoint.connectionNodeIds.join(",")}`,
        ]
          .filter(Boolean)
          .join("\n"),
      })
    }
  }

  // Draw section paths as dashed lines
  // strokeDash convention (same as visualizePointPathSolver):
  // - top layer (z=0): solid would be undefined, but we use "5 5" for dashed
  // - bottom layer (z=1): "10 5"
  // - transition between layers: "3 3 10"
  for (const sectionPath of section.sectionPaths) {
    const color = colorMap?.[sectionPath.connectionName] ?? "blue"

    for (let i = 0; i < sectionPath.points.length - 1; i++) {
      const pointA = sectionPath.points[i]
      const pointB = sectionPath.points[i + 1]

      const sameLayer = pointA.z === pointB.z
      const commonLayer = pointA.z

      let strokeDash: string
      if (sameLayer) {
        strokeDash = commonLayer === 0 ? "5 5" : "10 5"
      } else {
        strokeDash = "3 3 10"
      }

      graphics.lines!.push({
        points: [
          { x: pointA.x, y: pointA.y },
          { x: pointB.x, y: pointB.y },
        ],
        strokeColor: color,
        strokeDash,
      })
    }
  }

  return graphics
}
