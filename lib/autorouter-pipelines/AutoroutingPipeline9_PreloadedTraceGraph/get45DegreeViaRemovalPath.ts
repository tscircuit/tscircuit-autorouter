import { calculate45DegreePaths } from "@tscircuit/trace-simplification-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const COORDINATE_TOLERANCE_MM = 1e-9

export const get45DegreeViaRemovalPath = (
  path: HighDensityRoute["route"],
): HighDensityRoute["route"] => {
  return path.flatMap((point, index) => {
    const previous = path[index - 1]
    if (!previous) return [point]
    const dx = Math.abs(point.x - previous.x)
    const dy = Math.abs(point.y - previous.y)
    if (
      dx < COORDINATE_TOLERANCE_MM ||
      dy < COORDINATE_TOLERANCE_MM ||
      Math.abs(dx - dy) < COORDINATE_TOLERANCE_MM
    )
      return [point]
    const bend = calculate45DegreePaths(previous, point)[0]?.[1]
    if (!bend) throw new Error("Via removal requires a 45-degree attachment")
    return [{ x: bend.x, y: bend.y, z: point.z }, point]
  })
}
