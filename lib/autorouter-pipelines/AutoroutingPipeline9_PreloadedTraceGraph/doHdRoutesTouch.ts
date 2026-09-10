import type { HighDensityRoute } from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

const CONTACT_TOLERANCE_MM = 1e-9

export const doHdRoutesTouch = (
  a: HighDensityRoute,
  b: HighDensityRoute,
): boolean => {
  for (let i = 1; i < a.route.length; i++) {
    const p = a.route[i - 1]!
    const q = a.route[i]!
    if (p.toNextSegmentType) continue
    let aDiameter = p.traceThickness ?? a.traceThickness
    if (p.z !== q.z) aDiameter = a.viaDiameter
    for (let j = 1; j < b.route.length; j++) {
      const u = b.route[j - 1]!
      const v = b.route[j]!
      if (u.toNextSegmentType) continue
      const firstSharedLayer = Math.max(Math.min(p.z, q.z), Math.min(u.z, v.z))
      const lastSharedLayer = Math.min(Math.max(p.z, q.z), Math.max(u.z, v.z))
      if (firstSharedLayer > lastSharedLayer) continue
      let bDiameter = u.traceThickness ?? b.traceThickness
      if (u.z !== v.z) bDiameter = b.viaDiameter
      if (
        minimumDistanceBetweenSegments(p, q, u, v) <=
        (aDiameter + bDiameter) / 2 + CONTACT_TOLERANCE_MM
      )
        return true
    }
  }
  return false
}
