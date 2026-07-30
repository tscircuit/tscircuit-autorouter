import type { SimpleRouteJson } from "lib/types"

const DEFAULT_VIA_DIAMETER = 0.3
const DEFAULT_OBSTACLE_MARGIN = 0.15

/**
 * Gives RectDiff enough working area to route around pads and terminals that
 * extend beyond the declared board bounds. The returned SRJ is topology-only;
 * callers retain the original bounds for downstream geometry and DRC.
 */
export function getExpandedGlobalTopologySrj({
  inputSrj,
  viaDiameter,
  obstacleMargin,
}: {
  inputSrj: SimpleRouteJson
  viaDiameter?: number
  obstacleMargin?: number
}): SimpleRouteJson {
  const resolvedViaDiameter =
    viaDiameter ??
    inputSrj.minViaPadDiameter ??
    inputSrj.min_via_pad_diameter ??
    inputSrj.minViaDiameter ??
    DEFAULT_VIA_DIAMETER
  const resolvedObstacleMargin =
    obstacleMargin ?? inputSrj.defaultObstacleMargin ?? DEFAULT_OBSTACLE_MARGIN
  const routingClearance =
    Math.max(resolvedViaDiameter / 2, inputSrj.minTraceWidth / 2) +
    resolvedObstacleMargin
  const declaredBounds = inputSrj.bounds
  const bounds = { ...inputSrj.bounds }

  for (const obstacle of inputSrj.obstacles) {
    const obstacleMinX = obstacle.center.x - obstacle.width / 2
    const obstacleMaxX = obstacle.center.x + obstacle.width / 2
    const obstacleMinY = obstacle.center.y - obstacle.height / 2
    const obstacleMaxY = obstacle.center.y + obstacle.height / 2

    if (obstacleMinX < declaredBounds.minX) {
      bounds.minX = Math.min(bounds.minX, obstacleMinX - routingClearance)
    }
    if (obstacleMaxX > declaredBounds.maxX) {
      bounds.maxX = Math.max(bounds.maxX, obstacleMaxX + routingClearance)
    }
    if (obstacleMinY < declaredBounds.minY) {
      bounds.minY = Math.min(bounds.minY, obstacleMinY - routingClearance)
    }
    if (obstacleMaxY > declaredBounds.maxY) {
      bounds.maxY = Math.max(bounds.maxY, obstacleMaxY + routingClearance)
    }
  }

  for (const connection of inputSrj.connections) {
    for (const point of connection.pointsToConnect) {
      if (point.x < declaredBounds.minX) {
        bounds.minX = Math.min(bounds.minX, point.x - routingClearance)
      }
      if (point.x > declaredBounds.maxX) {
        bounds.maxX = Math.max(bounds.maxX, point.x + routingClearance)
      }
      if (point.y < declaredBounds.minY) {
        bounds.minY = Math.min(bounds.minY, point.y - routingClearance)
      }
      if (point.y > declaredBounds.maxY) {
        bounds.maxY = Math.max(bounds.maxY, point.y + routingClearance)
      }
    }
  }

  return {
    ...inputSrj,
    bounds,
  }
}
