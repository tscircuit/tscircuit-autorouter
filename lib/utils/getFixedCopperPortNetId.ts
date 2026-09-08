import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { HighDensityRoute } from "lib/types/high-density-types"

export interface FixedCopperObstacle {
  type: "rect" | "oval"
  center: { x: number; y: number }
  width: number
  height: number
  ccwRotationDegrees?: number
  zLayers: number[]
  netId: string | null
}

export interface FixedCopperGeometry {
  routes: HighDensityRoute[]
  traceWidth: number
  clearance: number
  obstacles?: FixedCopperObstacle[]
}

/** Restrict ports whose trace copper would violate immutable foreign copper. */
export const getFixedCopperPortNetId = (
  point: { x: number; y: number; z: number },
  { routes, traceWidth, clearance, obstacles }: FixedCopperGeometry,
): string | null | undefined => {
  let requiredNetId: string | undefined
  for (const route of routes) {
    const netId = route.rootConnectionName ?? route.connectionName
    for (let i = 1; i < route.route.length; i++) {
      const a = route.route[i - 1]!
      const b = route.route[i]!
      const via = a.z !== b.z
      if (point.z < Math.min(a.z, b.z) || point.z > Math.max(a.z, b.z)) {
        continue
      }
      const radius =
        (traceWidth + (via ? route.viaDiameter : route.traceThickness)) / 2
      const distance = pointToSegmentDistance(point, a, b)
      if (distance >= radius + clearance) continue
      if (requiredNetId !== undefined && requiredNetId !== netId) return null
      requiredNetId = netId
    }
  }
  for (const obstacle of obstacles ?? []) {
    const { netId } = obstacle
    if (!obstacle.zLayers.includes(point.z)) continue
    const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const dx = point.x - obstacle.center.x
    const dy = point.y - obstacle.center.y
    const x = Math.cos(angle) * dx + Math.sin(angle) * dy
    const y = -Math.sin(angle) * dx + Math.cos(angle) * dy
    const halfWidth = obstacle.width / 2
    const halfHeight = obstacle.height / 2
    let distance: number
    if (obstacle.type === "oval") {
      const radius = Math.min(halfWidth, halfHeight)
      const lineHalfX = Math.max(0, halfWidth - radius)
      const lineHalfY = Math.max(0, halfHeight - radius)
      distance = Math.max(
        0,
        Math.hypot(
          Math.max(0, Math.abs(x) - lineHalfX),
          Math.max(0, Math.abs(y) - lineHalfY),
        ) - radius,
      )
    } else {
      distance = Math.hypot(
        Math.max(0, Math.abs(x) - halfWidth),
        Math.max(0, Math.abs(y) - halfHeight),
      )
    }
    const requiredDistance = traceWidth / 2 + clearance
    // Bound arithmetic roundoff from subtracting and rotating board coordinates;
    // this scales with floating-point precision, not a physical clearance slack.
    const roundoff =
      16 *
      Number.EPSILON *
      Math.max(
        Math.abs(point.x),
        Math.abs(point.y),
        Math.abs(obstacle.center.x),
        Math.abs(obstacle.center.y),
        halfWidth,
        halfHeight,
        requiredDistance,
      )
    if (distance >= requiredDistance - roundoff) continue
    if (
      netId === null ||
      (requiredNetId !== undefined && requiredNetId !== netId)
    ) {
      return null
    }
    requiredNetId = netId
  }
  return requiredNetId
}
