import type { ProjectedRect } from "./geometry"
import type { PolyNodeWithPortPoints } from "./types"

export const getRequiredRoutingCorridorWidth = ({
  traceWidth,
  viaDiameter,
  obstacleMargin,
  minProjectedRectDimension,
}: {
  traceWidth?: number
  viaDiameter?: number
  obstacleMargin?: number
  minProjectedRectDimension: number
}) =>
  Math.max(
    minProjectedRectDimension,
    viaDiameter ?? 0,
    (traceWidth ?? 0) + 2 * (obstacleMargin ?? 0),
  )

export const shouldClampProjectionExpansion = ({
  node,
  projectedRect,
  conservativeProjectedRect,
  requiredRoutingCorridorWidth,
  traceWidth,
}: {
  node: PolyNodeWithPortPoints
  projectedRect: ProjectedRect
  conservativeProjectedRect: ProjectedRect
  requiredRoutingCorridorWidth: number
  traceWidth?: number
}) => {
  if (requiredRoutingCorridorWidth <= 0) return false

  const minDimension = Math.min(projectedRect.width, projectedRect.height)
  const conservativeMinDimension = Math.min(
    conservativeProjectedRect.width,
    conservativeProjectedRect.height,
  )
  const maxDimension = Math.max(projectedRect.width, projectedRect.height)
  const conservativeMaxDimension = Math.max(
    conservativeProjectedRect.width,
    conservativeProjectedRect.height,
  )
  const nextTraceLaneWidth = requiredRoutingCorridorWidth + (traceWidth ?? 0)
  const expandedLanesAcross = Math.floor(
    minDimension / requiredRoutingCorridorWidth,
  )
  const conservativeLanesAcross = Math.floor(
    conservativeMinDimension / requiredRoutingCorridorWidth,
  )
  const connectionCount = new Set(
    node.portPoints.map((portPoint) => portPoint.connectionName),
  ).size

  return (
    connectionCount > 1 &&
    expandedLanesAcross <= conservativeLanesAcross &&
    minDimension <= nextTraceLaneWidth &&
    maxDimension - conservativeMaxDimension >= requiredRoutingCorridorWidth &&
    projectedRect.equivalentAreaExpansionFactor > 1
  )
}
