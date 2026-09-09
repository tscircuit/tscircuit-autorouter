import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { HighDensityRoute } from "lib/types/high-density-types"

export interface FixedCopperGeometry {
  routes: HighDensityRoute[]
  traceWidth: number
  clearance: number
}

/** Restrict ports whose trace copper would violate immutable foreign copper. */
export const getFixedCopperPortNetId = (
  point: { x: number; y: number; z: number },
  { routes, traceWidth, clearance }: FixedCopperGeometry,
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
  return requiredNetId
}
