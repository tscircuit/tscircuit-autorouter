import { CLEARANCE_SLACK } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import type { Pipeline9PadCopperForceTarget } from "./getPipeline9PadCopperForceTarget"

type Point = { x: number; y: number }
type PadProjection = {
  along: number
  normal: number
  alongRadius: number
  normalRadius: number
}
type PadTraceDetourParams = {
  route: HighDensityRoute
  target: Pipeline9PadCopperForceTarget
  pad: Record<string, unknown>
  minimumClearance: number
  direction: "nearest" | "opposite"
  bounds: SimpleRouteJson["bounds"]
  layerCount: number
}

const getPhysicalPadProjection = (
  pad: Record<string, unknown>,
  target: Pipeline9PadCopperForceTarget,
  start: Point,
  tangent: Point,
  normal: Point,
  layer: string,
): PadProjection | undefined => {
  const isSmt = pad.type === "pcb_smtpad"
  const isPlated = pad.type === "pcb_plated_hole"
  const id = isSmt ? pad.pcb_smtpad_id : pad.pcb_plated_hole_id
  const layers = isSmt ? [pad.layer] : pad.layers
  if (
    (!isSmt && !isPlated) ||
    typeof id !== "string" ||
    typeof pad.x !== "number" ||
    typeof pad.y !== "number" ||
    !Number.isFinite(pad.x) ||
    !Number.isFinite(pad.y) ||
    !Array.isArray(layers) ||
    layers.length === 0 ||
    !layers.every((value): value is string => typeof value === "string") ||
    target.obstacles.length === 0 ||
    target.obstacles.some((obstacle) => !obstacle.connectedTo.includes(id))
  ) {
    throw new Error("Pipeline9 pad detour requires its exact physical copper")
  }
  if (!layers.includes(layer)) return undefined
  const deltaX = pad.x - start.x
  const deltaY = pad.y - start.y
  const along = deltaX * tangent.x + deltaY * tangent.y
  const across = deltaX * normal.x + deltaY * normal.y
  if (isPlated && pad.shape === "circle") {
    const diameter = pad.outer_diameter
    if (
      typeof diameter !== "number" ||
      !Number.isFinite(diameter) ||
      diameter <= 0
    ) {
      throw new Error("Pipeline9 pad detour requires finite circular copper")
    }
    return {
      along,
      normal: across,
      alongRadius: diameter / 2,
      normalRadius: diameter / 2,
    }
  }
  const isRect = isSmt
    ? pad.shape === "rect" || pad.shape === "rotated_rect"
    : pad.shape === "circular_hole_with_rect_pad" ||
      pad.shape === "rotated_pill_hole_with_rect_pad"
  const width = isSmt ? pad.width : pad.rect_pad_width
  const height = isSmt ? pad.height : pad.rect_pad_height
  const rotation = isSmt
    ? pad.shape === "rotated_rect"
      ? pad.ccw_rotation
      : 0
    : pad.shape === "rotated_pill_hole_with_rect_pad"
      ? (pad.rect_ccw_rotation ?? 0)
      : 0
  if (
    !isRect ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    typeof rotation !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(rotation) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(
      "Pipeline9 pad detour requires supported rectangular copper",
    )
  }
  const angle = (rotation * Math.PI) / 180
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  // These are the exact support extents of the physical rotated rectangle,
  // not the force context's approximating rectangles or an inferred pad ID.
  return {
    along,
    normal: across,
    alongRadius:
      (Math.abs(tangent.x * cosine + tangent.y * sine) * width +
        Math.abs(-tangent.x * sine + tangent.y * cosine) * height) /
      2,
    normalRadius:
      (Math.abs(normal.x * cosine + normal.y * sine) * width +
        Math.abs(-normal.x * sine + normal.y * cosine) * height) /
      2,
  }
}

/** Inserts an interior pad bypass without moving any existing wire or via point. */
export const applyPipeline9PadTraceDetour = ({
  route,
  target,
  pad,
  minimumClearance,
  direction,
  bounds,
  layerCount,
}: PadTraceDetourParams): boolean => {
  const start = route.route[target.segmentIndex]
  const end = route.route[target.segmentIndex + 1]
  if (!start || !end) {
    throw new Error("Pipeline9 pad detour requires its selected segment")
  }
  if (start.z !== end.z || start.toNextSegmentType === "through_obstacle") {
    return false
  }
  const width = start.traceThickness ?? route.traceThickness
  if (
    !Number.isFinite(minimumClearance) ||
    minimumClearance < 0 ||
    !Number.isFinite(width) ||
    width <= 0
  ) {
    throw new Error(
      "Pipeline9 pad detour requires official clearance and width",
    )
  }
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const length = Math.hypot(deltaX, deltaY)
  if (!Number.isFinite(length)) {
    throw new Error("Pipeline9 pad detour requires a finite segment")
  }
  if (length === 0) return false
  const tangent = { x: deltaX / length, y: deltaY / length }
  const normal = { x: -tangent.y, y: tangent.x }
  const projection = getPhysicalPadProjection(
    pad,
    target,
    start,
    tangent,
    normal,
    mapZToLayerName(start.z, layerCount),
  )
  if (projection === undefined) return false
  const margin = width / 2 + minimumClearance + CLEARANCE_SLACK
  const before = projection.along - projection.alongRadius - margin
  const after = projection.along + projection.alongRadius + margin
  const lower = projection.normal - projection.normalRadius - margin
  const upper = projection.normal + projection.normalRadius + margin
  if (![before, after, lower, upper].every(Number.isFinite)) {
    throw new Error("Pipeline9 pad detour requires finite projected copper")
  }
  // This insertion family cannot repair a locked endpoint inside the required
  // clearance envelope. Never extrapolate beyond it or move an anchor instead.
  if (before <= 0 || after >= length || lower >= 0 || upper <= 0) return false
  const nearestIsLower = Math.abs(lower) <= Math.abs(upper)
  const useLower = direction === "nearest" ? nearestIsLower : !nearestIsLower
  const offset = useLower ? lower : upper
  const coordinates: Array<[number, number]> = [
    [before, 0],
    [before, offset],
    [after, offset],
    [after, 0],
  ]
  const waypoints = coordinates.map(
    ([along, across]): HighDensityRoute["route"][number] => ({
      x: start.x + tangent.x * along + normal.x * across,
      y: start.y + tangent.y * along + normal.y * across,
      z: start.z,
      traceThickness: width,
    }),
  )
  if (
    waypoints.some(
      (point) =>
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < bounds.minX ||
        point.x > bounds.maxX ||
        point.y < bounds.minY ||
        point.y > bounds.maxY,
    )
  ) {
    return false
  }
  // Each new leg lies outside an expanded physical-copper support face. The
  // full official checks still decide all-copper acceptance. Keep the original
  // endpoint objects, their metadata, adjacent protected spans and every via.
  route.route.splice(target.segmentIndex + 1, 0, ...waypoints)
  return true
}
