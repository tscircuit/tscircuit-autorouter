import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { SCALE } from "./constants"
import type { Rect } from "./types"

export const CAPACITY_NODE_EDITOR_VIEW_PADDING_PX = 80

export function getInitialCapacityNodeEditorView({
  nodeWithPortPoints,
  viewportWidth,
  viewportHeight,
  paddingPx = CAPACITY_NODE_EDITOR_VIEW_PADDING_PX,
  maxPixelsPerMm = SCALE,
}: {
  nodeWithPortPoints: Pick<NodeWithPortPoints, "width" | "height">
  viewportWidth: number
  viewportHeight: number
  paddingPx?: number
  maxPixelsPerMm?: number
}): {
  rect: Rect
  pixelsPerMm: number
} {
  const widthMm = Math.max(nodeWithPortPoints.width, 0.2)
  const heightMm = Math.max(nodeWithPortPoints.height, 0.2)
  const availableWidth = Math.max(viewportWidth - paddingPx * 2, 1)
  const availableHeight = Math.max(viewportHeight - paddingPx * 2, 1)
  const pixelsPerMm = Math.min(
    maxPixelsPerMm,
    availableWidth / widthMm,
    availableHeight / heightMm,
  )
  const rectWidth = widthMm * pixelsPerMm
  const rectHeight = heightMm * pixelsPerMm

  return {
    pixelsPerMm,
    rect: {
      x: (viewportWidth - rectWidth) / 2,
      y: (viewportHeight - rectHeight) / 2,
      width: rectWidth,
      height: rectHeight,
    },
  }
}
