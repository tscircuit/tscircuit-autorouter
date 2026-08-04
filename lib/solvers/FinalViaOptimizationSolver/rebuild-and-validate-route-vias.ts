import type { HighDensityRoute } from "lib/types/high-density-types"

const samePoint = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9

/** Rebuilds ordinary via metadata and rejects transitions with no legal location. */
export const rebuildAndValidateRouteVias = (
  route: HighDensityRoute,
): HighDensityRoute | null => {
  if (route.route.length < 2) return null

  const vias: HighDensityRoute["vias"] = []
  for (let index = 1; index < route.route.length; index++) {
    const previous = route.route[index - 1]!
    const current = route.route[index]!
    if (previous.z === current.z) continue
    if (previous.toNextSegmentType === "through_obstacle") return null
    if (!samePoint(previous, current)) return null
    if (!vias.some((via) => samePoint(via, current))) {
      vias.push({ x: current.x, y: current.y })
    }
  }

  return { ...route, vias }
}
