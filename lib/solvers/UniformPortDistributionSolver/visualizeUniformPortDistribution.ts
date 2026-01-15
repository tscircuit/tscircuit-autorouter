import { GraphicsObject, Line } from "graphics-debug"
import { Obstacle } from "lib/types"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import { NodeAndSide, Bounds, PortPointWithSide } from "./types"
import { getSideLineCoordinates } from "./getSideLineCoordinates"

export const visualizeUniformPortDistribution = ({
  obstacles,
  nodeWithPortPoints,
  mapOfNodeAndSideToPortPoints,
  sidesToProcess,
  currentSideBeingProcessed,
  mapOfNodeIdToBounds,
}: {
  obstacles: Obstacle[]
  nodeWithPortPoints: NodeWithPortPoints[]
  mapOfNodeAndSideToPortPoints: Map<string, PortPointWithSide[]>
  sidesToProcess: NodeAndSide[]
  currentSideBeingProcessed: NodeAndSide | null
  mapOfNodeIdToBounds: Map<string, Bounds>
}): GraphicsObject => {
  const rects = obstacles.map((o) => ({ ...o, fill: "#00000037" }))
  const points: { x: number; y: number }[] = []
  const lines: Line[] = []

  const portPointMap = new Map<string, { x: number; y: number }>()

  for (const node of nodeWithPortPoints) {
    for (const pp of node.portPoints) {
      if (pp.portPointId) {
        portPointMap.set(pp.portPointId, { x: pp.x, y: pp.y })
      }
    }
  }

  for (const portPoints of mapOfNodeAndSideToPortPoints.values()) {
    for (const pp of portPoints) {
      if (pp.portPointId) {
        portPointMap.set(pp.portPointId, { x: pp.x, y: pp.y })
      }
    }
  }

  points.push(...portPointMap.values())

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

  for (const { nodeId, side } of sidesToProcess) {
    const bounds = mapOfNodeIdToBounds.get(nodeId)!
    const { x1, y1, x2, y2 } = getSideLineCoordinates({ bounds, side })
    lines.push({
      points: [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ],
      strokeColor: "orange",
      strokeWidth: 0.01,
    })
  }

  if (currentSideBeingProcessed) {
    const { nodeId, side } = currentSideBeingProcessed
    const bounds = mapOfNodeIdToBounds.get(nodeId)!
    const { x1, y1, x2, y2 } = getSideLineCoordinates({ bounds, side })
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
