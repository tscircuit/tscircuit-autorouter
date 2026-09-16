import type { HighDensityRoute } from "lib/types/high-density-types"

type IsPipeline9ViaSegmentParams = {
  hdRoute: HighDensityRoute
  start: HighDensityRoute["route"][number]
  end: HighDensityRoute["route"][number]
}

export const isPipeline9ViaSegment = ({
  hdRoute,
  start,
  end,
}: IsPipeline9ViaSegmentParams): boolean => {
  if (start.z !== end.z) return true
  if (Math.hypot(end.x - start.x, end.y - start.y) > 1e-9) return false
  // A preloaded via can have coincident logical endpoints on the same layer.
  return hdRoute.vias.some(
    (via) => Math.hypot(via.x - end.x, via.y - end.y) <= 1e-9,
  )
}
