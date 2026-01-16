import { GraphicsObject, Line, Rect } from "graphics-debug"
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
  const rects: Rect[] = obstacles.map((o) => ({ ...o, fill: "#ec000070" }))
  const points: Array<{ x: number; y: number; label?: string }> = []
  const lines: Line[] = []

  const portPointMap = new Map<string, { x: number; y: number }>()
  const portPointZMap = new Map<string, number>()
  const portPointOwnerMap = new Map<string, string>()

  for (const node of nodeWithPortPoints) {
    for (const pp of node.portPoints) {
      if (pp.portPointId) {
        portPointMap.set(pp.portPointId, { x: pp.x, y: pp.y })
        portPointZMap.set(pp.portPointId, pp.z ?? 0)
      }
    }
  }

  for (const portPoints of mapOfNodeAndSideToPortPoints.values()) {
    for (const pp of portPoints) {
      if (pp.portPointId) {
        portPointMap.set(pp.portPointId, { x: pp.x, y: pp.y })
        portPointZMap.set(pp.portPointId, pp.z ?? 0)
        portPointOwnerMap.set(pp.portPointId, pp.ownerNodeId)
      }
    }
  }

  nodeWithPortPoints.forEach((element) => {
    const bounds = mapOfNodeIdToBounds.get(element.capacityMeshNodeId)
    if (bounds) {
      const centerX = (bounds.minX + bounds.maxX) / 2
      const centerY = (bounds.minY + bounds.maxY) / 2
      const width = bounds.maxX - bounds.minX
      const height = bounds.maxY - bounds.minY
      rects.push({
        center: { x: centerX, y: centerY },
        width,
        height,
        fill: "#00000030",
        label: `${element.capacityMeshNodeId}`,
      })
    }

    element.portPoints.forEach((e) => {
      if (!e.portPointId) return
      const posE = portPointMap.get(e.portPointId)!
      const zLayer = portPointZMap.get(e.portPointId) ?? 0
      const owner =
        portPointOwnerMap.get(e.portPointId) ?? element.capacityMeshNodeId

      points.push({
        x: posE.x,
        y: posE.y,
        label: `z:${zLayer}\no:${owner}`,
      })

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
