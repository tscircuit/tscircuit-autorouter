import { GraphicsObject, Line, Rect } from "graphics-debug"
import { Obstacle } from "lib/types"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import {
  Bounds,
  OwnerPairKey,
  PortPointWithOwnerPair,
  SharedEdge,
} from "./types"

/**
 * Renders a debug view of owner-pair families, redistributed port points,
 * and precomputed shared edges to make solver decisions visually inspectable.
 */
export const visualizeUniformPortDistribution = ({
  obstacles,
  nodeWithPortPoints,
  mapOfOwnerPairToPortPoints,
  mapOfOwnerPairToSharedEdge,
  ownerPairsToProcess,
  currentOwnerPairBeingProcessed,
  mapOfNodeIdToBounds,
}: {
  obstacles: Obstacle[]
  nodeWithPortPoints: NodeWithPortPoints[]
  mapOfOwnerPairToPortPoints: Map<OwnerPairKey, PortPointWithOwnerPair[]>
  mapOfOwnerPairToSharedEdge: Map<OwnerPairKey, SharedEdge>
  ownerPairsToProcess: OwnerPairKey[]
  currentOwnerPairBeingProcessed: OwnerPairKey | null
  mapOfNodeIdToBounds: Map<string, Bounds>
}): GraphicsObject => {
  const rects: Rect[] = obstacles.map((o) => ({ ...o, fill: "#ec000070" }))
  const points: Array<{ x: number; y: number; label?: string }> = []
  const lines: Line[] = []

  const portPointMap = new Map<string, { x: number; y: number }>()
  const portPointZMap = new Map<string, number>()
  const portPointOwnerPairMap = new Map<string, string>()

  for (const node of nodeWithPortPoints) {
    for (const pp of node.portPoints) {
      if (pp.portPointId) {
        portPointMap.set(pp.portPointId, { x: pp.x, y: pp.y })
        portPointZMap.set(pp.portPointId, pp.z ?? 0)
      }
    }
  }

  for (const portPoints of mapOfOwnerPairToPortPoints.values()) {
    for (const pp of portPoints) {
      if (pp.portPointId) {
        portPointMap.set(pp.portPointId, { x: pp.x, y: pp.y })
        portPointZMap.set(pp.portPointId, pp.z ?? 0)
        portPointOwnerPairMap.set(
          pp.portPointId,
          `${pp.ownerNodeIds[0]}&${pp.ownerNodeIds[1]}`,
        )
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
      const ownerPair =
        portPointOwnerPairMap.get(e.portPointId) ??
        `${element.capacityMeshNodeId}&${element.capacityMeshNodeId}`

      points.push({
        x: posE.x,
        y: posE.y,
        label: `z:${zLayer}\no:${ownerPair}`,
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

  for (const ownerPairKey of ownerPairsToProcess) {
    const sharedEdge = mapOfOwnerPairToSharedEdge.get(ownerPairKey)
    if (!sharedEdge) continue
    lines.push({
      points: [
        { x: sharedEdge.x1, y: sharedEdge.y1 },
        { x: sharedEdge.x2, y: sharedEdge.y2 },
      ],
      strokeColor: "orange",
      strokeWidth: 0.01,
    })
  }

  if (currentOwnerPairBeingProcessed) {
    const sharedEdge = mapOfOwnerPairToSharedEdge.get(
      currentOwnerPairBeingProcessed,
    )
    if (sharedEdge) {
      lines.push({
        points: [
          { x: sharedEdge.x1, y: sharedEdge.y1 },
          { x: sharedEdge.x2, y: sharedEdge.y2 },
        ],
        strokeColor: "red",
        strokeWidth: 0.03,
      })
      points.push({
        x: sharedEdge.center.x,
        y: sharedEdge.center.y,
        label: sharedEdge.ownerPairKey,
      })
    }
  }

  for (const sharedEdge of mapOfOwnerPairToSharedEdge.values()) {
    lines.push({
      points: [
        { x: sharedEdge.x1, y: sharedEdge.y1 },
        { x: sharedEdge.x2, y: sharedEdge.y2 },
      ],
      strokeColor: "#33b5ff80",
      strokeWidth: 0.006,
    })
  }
  return { rects, lines, points }
}
