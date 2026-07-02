import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNode } from "lib/types"

const Z_FILL_COLORS = [
  "rgba(0,200,200,0.18)",
  "rgba(0,0,200,0.18)",
  "rgba(200,120,0,0.18)",
  "rgba(160,0,200,0.18)",
  "rgba(0,160,80,0.18)",
]

const Z_STROKE_COLORS = [
  "rgba(0,140,140,0.9)",
  "rgba(0,0,160,0.9)",
  "rgba(160,90,0,0.9)",
  "rgba(120,0,160,0.9)",
  "rgba(0,120,60,0.9)",
]

const SEAM_STROKE_COLOR = "rgba(220,20,60,0.95)"

const fillForZ = (z: number): string => Z_FILL_COLORS[z % Z_FILL_COLORS.length]!

const strokeForZ = (z: number): string =>
  Z_STROKE_COLORS[z % Z_STROKE_COLORS.length]!

/**
 * Draws each region as a pseudo-isometric stack: one rect per z-layer, offset
 * diagonally by `z * width * zOffset` (modeled on createRectFromCapacityNode).
 * Seam regions get a distinct stroke so bridges stand out from source regions.
 */
export const visualizeTopologyIsometric = (
  regions: CapacityMeshNode[],
  opts: { zOffset?: number } = {},
): GraphicsObject => {
  const zOffset = opts.zOffset ?? 0.08
  const rects: NonNullable<GraphicsObject["rects"]> = []

  for (const region of regions) {
    for (const z of region.availableZ) {
      const dx = z * region.width * zOffset
      const dy = z * region.width * zOffset
      rects.push({
        center: {
          x: region.center.x + dx,
          y: region.center.y - dy,
        },
        width: region.width,
        height: region.height,
        fill: fillForZ(z),
        stroke: region._muSeam ? SEAM_STROKE_COLOR : strokeForZ(z),
        label: `${region.capacityMeshNodeId}\nz=${z}`,
      })
    }
  }

  return {
    title: "Merged topology (isometric)",
    rects,
    lines: [],
    points: [],
    circles: [],
    texts: [],
  }
}

/**
 * Lays out `layerCount` flat mini-boards left-to-right. Board i shows every
 * region whose availableZ includes z=i, giving a per-layer "slice" view.
 */
export const visualizeTopologySlices = (
  regions: CapacityMeshNode[],
  layerCount: number,
): GraphicsObject => {
  if (regions.length === 0) {
    throw new Error("visualizeTopologySlices requires at least one region")
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const region of regions) {
    minX = Math.min(minX, region.center.x - region.width / 2)
    maxX = Math.max(maxX, region.center.x + region.width / 2)
    maxY = Math.max(maxY, region.center.y + region.height / 2)
  }

  const boardWidth = maxX - minX
  const gap = boardWidth * 0.25
  const stride = boardWidth + gap

  const rects: NonNullable<GraphicsObject["rects"]> = []
  const texts: NonNullable<GraphicsObject["texts"]> = []

  for (let z = 0; z < layerCount; z += 1) {
    const shiftX = z * stride
    texts.push({
      text: `z=${z}`,
      x: minX + boardWidth / 2 + shiftX,
      y: maxY + boardWidth * 0.15,
      fontSize: Math.max(boardWidth * 0.12, 0.3),
    })

    for (const region of regions) {
      if (!region.availableZ.includes(z)) continue
      rects.push({
        center: { x: region.center.x + shiftX, y: region.center.y },
        width: region.width,
        height: region.height,
        fill: fillForZ(z),
        stroke: region._muSeam ? SEAM_STROKE_COLOR : strokeForZ(z),
        label: `${region.capacityMeshNodeId}\nz=${z}`,
      })
    }
  }

  return {
    title: "Merged topology (slices)",
    rects,
    lines: [],
    points: [],
    circles: [],
    texts,
  }
}
