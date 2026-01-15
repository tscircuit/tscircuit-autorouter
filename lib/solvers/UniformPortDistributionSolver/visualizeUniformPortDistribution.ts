import { GraphicsObject, Line } from "graphics-debug"
import { Obstacle } from "lib/types"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import { NodeAndSide, NodeBounds, PortPointWithSide } from "./types"

export const visualizeUniformPortDistribution = ({
  obstacles,
  nodeWithPortPoints,
  mapOfNodeAndSideToPortPoints,
  nodeAndSideQueue,
  currentNodeAndSide,
  mapOfNodeIdToBounds,
}: {
  obstacles: Obstacle[]
  nodeWithPortPoints: NodeWithPortPoints[]
  mapOfNodeAndSideToPortPoints: Map<string, PortPointWithSide[]>
  nodeAndSideQueue: NodeAndSide[]
  currentNodeAndSide: NodeAndSide | null
  mapOfNodeIdToBounds: Map<string, NodeBounds>
}): GraphicsObject => {
  const rects = obstacles.map((o) => ({ ...o, fill: "#00000037" }))
  const points: { x: number; y: number }[] = []
  const lines: Line[] = []

  const portPointMap = new Map<string, { x: number; y: number }>()

  // Initialize with original positions
  for (const node of nodeWithPortPoints) {
    for (const pp of node.portPoints) {
      if (pp.portPointId) {
        portPointMap.set(pp.portPointId, { x: pp.x, y: pp.y })
      }
    }
  }

  // Update with redistributed positions
  for (const portPoints of mapOfNodeAndSideToPortPoints.values()) {
    for (const pp of portPoints) {
      if (pp.portPointId) {
        portPointMap.set(pp.portPointId, { x: pp.x, y: pp.y })
      }
    }
  }

  for (const pos of portPointMap.values()) {
    points.push(pos)
  }

  nodeWithPortPoints.forEach((element) => {
    element.portPoints.forEach((e) => {
      if (!e.portPointId) return
      const posE = portPointMap.get(e.portPointId)!

      element.portPoints.forEach((f) => {
        if (!f.portPointId || e === f) return
        if (e.connectionName === f.connectionName) {
          const posF = portPointMap.get(f.portPointId)!
          lines.push({
            points: [posE, posF],
            strokeColor: "#fff822c9",
          })
        }
      })
    })
  })

  for (const { nodeId, side } of nodeAndSideQueue) {
    const b = mapOfNodeIdToBounds.get(nodeId)!
    let x1 = 0,
      y1 = 0,
      x2 = 0,
      y2 = 0
    if (side === "top") {
      x1 = b.minX
      y1 = b.maxY
      x2 = b.maxX
      y2 = b.maxY
    } else if (side === "bottom") {
      x1 = b.minX
      y1 = b.minY
      x2 = b.maxX
      y2 = b.minY
    } else if (side === "left") {
      x1 = b.minX
      y1 = b.minY
      x2 = b.minX
      y2 = b.maxY
    } else if (side === "right") {
      x1 = b.maxX
      y1 = b.minY
      x2 = b.maxX
      y2 = b.maxY
    }
    lines.push({
      points: [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ],
      strokeColor: "orange",
      strokeWidth: 0.01,
    })
  }

  if (currentNodeAndSide) {
    const { nodeId, side } = currentNodeAndSide
    const b = mapOfNodeIdToBounds.get(nodeId)!
    let x1 = 0,
      y1 = 0,
      x2 = 0,
      y2 = 0
    if (side === "top") {
      x1 = b.minX
      y1 = b.maxY
      x2 = b.maxX
      y2 = b.maxY
    } else if (side === "bottom") {
      x1 = b.minX
      y1 = b.minY
      x2 = b.maxX
      y2 = b.minY
    } else if (side === "left") {
      x1 = b.minX
      y1 = b.minY
      x2 = b.minX
      y2 = b.maxY
    } else if (side === "right") {
      x1 = b.maxX
      y1 = b.minY
      x2 = b.maxX
      y2 = b.maxY
    }
    lines.push({
      points: [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ],
      strokeColor: "red",
      strokeWidth: 0.03,
    })
  }
  return { rects, lines, points }
}
