import type { Circle, GraphicsObject, Line, Point, Rect } from "graphics-debug"
import type { HgPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/HgPortPointPathingSolver"

/**
 * Visualize the hypergraph port point graph.
 */
export function visualizeHgPortPointPathingSolverGraph({
  solver,
}: {
  solver: HgPortPointPathingSolver
}): GraphicsObject {
  const lines: Line[] = []
  const circles: Circle[] = []
  const points: Point[] = []
  const rects: Rect[] = []

  for (const node of solver.inputNodes) {
    const pf = solver.computeNodePf(node)
    const red = Math.min(255, Math.floor(pf * 512))
    const greenAndBlue = Math.max(0, 255 - Math.floor(pf * 512))
    let color = `rgba(${red}, ${greenAndBlue}, ${greenAndBlue}, ${pf < 0.001 ? "0.1" : "0.3"})`

    if (node._containsObstacle) {
      color = "rgba(255, 0, 0, 0.3)"
    }

    if (node._offBoardConnectedCapacityMeshNodeIds?.length) {
      color = "rgba(255, 165, 0, 0.3)"
    }

    rects.push({
      center: node.center,
      width: node.width,
      height: node.height,
      stroke: "rgba(80, 80, 120, 0.15)",
      fill: color,
      label: `${node.capacityMeshNodeId}\npf: ${pf.toFixed(3)}`,
    })
  }

  for (const portPoint of solver.portPointMap.values()) {
    circles.push({
      center: { x: portPoint.x, y: portPoint.y },
      radius: 0.035,
      fill: "rgba(120, 120, 120, 0.3)",
    })
  }

  for (const port of solver.graph.ports) {
    const r1Center = port.region1.d.center
    const r2Center = port.region2.d.center
    lines.push({
      points: [r1Center, { x: port.d.x, y: port.d.y }, r2Center],
      strokeColor: "rgba(100, 100, 100, 0.1)",
      strokeWidth: 0.03,
    })
  }

  for (const connection of solver.connections) {
    const startCenter = connection.startRegion.d.center
    const endCenter = connection.endRegion.d.center
    const midX = (startCenter.x + endCenter.x) / 2
    const midY = (startCenter.y + endCenter.y) / 2
    lines.push({
      points: [startCenter, endCenter],
      strokeColor: "rgba(255, 50, 150, 0.2)",
      strokeWidth: 0.05,
    })
    points.push({
      x: midX,
      y: midY,
      color: "rgba(200, 0, 100, 0.9)",
      label: connection.connectionId,
    })
  }

  return {
    lines,
    circles,
    points,
    rects,
  }
}
