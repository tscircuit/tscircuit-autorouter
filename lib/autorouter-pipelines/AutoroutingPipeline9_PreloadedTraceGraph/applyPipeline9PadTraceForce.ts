import {
  CLEARANCE_SLACK,
  TRACE_PAD_REPAIR_MAX_MOVE,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Pipeline9PadCopperForceTarget } from "./getPipeline9PadCopperForceTarget"

type Pipeline9PadTraceForceParams = {
  route: HighDensityRoute
  target: Pipeline9PadCopperForceTarget
  protectedPointIndexes: ReadonlySet<number>
  minimumClearance: number
  scale: number
}

export type Pipeline9PadTraceForceMobility = {
  pointIndexes: number[]
  contactWeight: number
}

export const getPipeline9PadTraceForceMovablePointIndexes = ({
  route,
  target,
  protectedPointIndexes,
}: Pick<
  Pipeline9PadTraceForceParams,
  "route" | "target" | "protectedPointIndexes"
>): number[] => {
  const startIndex = target.segmentIndex
  const endIndex = startIndex + 1
  const start = route.route[startIndex]
  const end = route.route[endIndex]
  if (!start || !end || start.z !== end.z) {
    throw new Error(
      "Pipeline9 pad-wire force requires its exact planar segment",
    )
  }
  const fixedIndexes = new Set(protectedPointIndexes)
  const firstPoint = route.route[0]!
  const lastPoint = route.route.at(-1)!
  for (let index = 0; index < route.route.length; index++) {
    const point = route.route[index]!
    if (point.x !== firstPoint.x || point.y !== firstPoint.y) break
    fixedIndexes.add(index)
  }
  for (let index = route.route.length - 1; index >= 0; index--) {
    const point = route.route[index]!
    if (point.x !== lastPoint.x || point.y !== lastPoint.y) break
    fixedIndexes.add(index)
  }
  for (const [index, point] of route.route.entries()) {
    if (point.pcb_port_id || point.insideJumperPad) fixedIndexes.add(index)
    if (point.toNextSegmentType === "through_obstacle") {
      fixedIndexes.add(index)
      fixedIndexes.add(index + 1)
    }
    // Explicit via sites and every coincident layer-transition stack retain
    // their exact position. Only the wire endpoint outside that stack can move.
    if (route.vias.some((via) => via.x === point.x && via.y === point.y)) {
      fixedIndexes.add(index)
    }
    const next = route.route[index + 1]
    if (
      !next ||
      point.z === next.z ||
      point.x !== next.x ||
      point.y !== next.y
    ) {
      continue
    }
    let first = index
    let last = index + 1
    while (
      first > 0 &&
      route.route[first - 1]!.x === point.x &&
      route.route[first - 1]!.y === point.y
    ) {
      first--
    }
    while (
      last + 1 < route.route.length &&
      route.route[last + 1]!.x === point.x &&
      route.route[last + 1]!.y === point.y
    ) {
      last++
    }
    for (let cursor = first; cursor <= last; cursor++) {
      fixedIndexes.add(cursor)
    }
  }
  return [startIndex, endIndex].filter((index) => !fixedIndexes.has(index))
}

export const getPipeline9PadTraceForceMobility = ({
  route,
  target,
  protectedPointIndexes,
}: Pick<
  Pipeline9PadTraceForceParams,
  "route" | "target" | "protectedPointIndexes"
>): Pipeline9PadTraceForceMobility => {
  const pointIndexes = getPipeline9PadTraceForceMovablePointIndexes({
    route,
    target,
    protectedPointIndexes,
  })
  // Translating both endpoints moves the complete segment rigidly. With one
  // locked endpoint, only the witness's barycentric share of the free endpoint
  // displacement reaches the original contact point.
  if (pointIndexes.length !== 1) {
    return { pointIndexes, contactWeight: pointIndexes.length === 2 ? 1 : 0 }
  }
  const movableIndex = pointIndexes[0]!
  const fixedIndex =
    movableIndex === target.segmentIndex
      ? target.segmentIndex + 1
      : target.segmentIndex
  const fixed = route.route[fixedIndex]!
  const movable = route.route[movableIndex]!
  const segmentX = movable.x - fixed.x
  const segmentY = movable.y - fixed.y
  const length = Math.hypot(segmentX, segmentY)
  if (!Number.isFinite(length) || length === 0) {
    throw new Error("Pipeline9 pad-wire mobility requires a finite segment")
  }
  const weight =
    ((target.tracePoint.x - fixed.x) * (segmentX / length) +
      (target.tracePoint.y - fixed.y) * (segmentY / length)) /
    length
  if (!Number.isFinite(weight)) {
    throw new Error("Pipeline9 pad-wire mobility requires a finite witness")
  }
  return { pointIndexes, contactWeight: Math.max(0, Math.min(1, weight)) }
}

/** Moves only the offending wire's free endpoints, never incidental vias. */
export const applyPipeline9PadTraceForce = ({
  route,
  target,
  protectedPointIndexes,
  minimumClearance,
  scale,
}: Pipeline9PadTraceForceParams): boolean => {
  const { pointIndexes, contactWeight } = getPipeline9PadTraceForceMobility({
    route,
    target,
    protectedPointIndexes,
  })
  // A contact/interior witness has no outward normal. It is outside this
  // clearance-displacement family's domain; the native family is independent.
  if (target.distance === 0 || contactWeight === 0) return false
  if (!Number.isFinite(minimumClearance) || minimumClearance < 0) {
    throw new Error("Pipeline9 pad-wire force requires an official clearance")
  }
  const start = route.route[target.segmentIndex]!
  const requiredDistance =
    (start.traceThickness ?? route.traceThickness) / 2 +
    minimumClearance +
    CLEARANCE_SLACK
  const penetration = requiredDistance - target.distance
  if (penetration <= 0) return false
  const move = Math.min(
    TRACE_PAD_REPAIR_MAX_MOVE * Math.abs(scale),
    (penetration + CLEARANCE_SLACK) / contactWeight,
  )
  if (move === 0) return false
  const dx = ((target.tracePoint.x - target.center.x) / target.distance) * move
  const dy = ((target.tracePoint.y - target.center.y) / target.distance) * move
  for (const index of pointIndexes) {
    const point = route.route[index]!
    point.x += dx
    point.y += dy
  }
  return true
}
