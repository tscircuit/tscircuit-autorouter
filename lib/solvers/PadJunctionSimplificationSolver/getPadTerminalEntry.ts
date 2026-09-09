import type {
  BranchAnchor,
  PadJunctionBounds,
  PadJunctionPoint,
  TargetPad,
} from "./padJunctionGeometry"
import { EPSILON, getItemOrThrow, getPathCost } from "./padJunctionGeometry"

// Routing coordinates may be rounded to 0.001 mm while pad centers are exact.
export const PAD_TERMINAL_TOLERANCE = 0.001

type PadSide = "left" | "right" | "bottom" | "top"
export type PadTerminalEntry = {
  branch: BranchAnchor
  sides: PadSide[]
  point: PadJunctionPoint
  perpendicularToSide: boolean
}

/** Find the last straight entry and preserve all copper before the local window. */
export function getPadTerminalEntry(
  branch: BranchAnchor,
  pad: TargetPad,
  bounds: PadJunctionBounds,
): PadTerminalEntry | null {
  const terminal = branch.terminal
  const inside = (point: PadJunctionPoint): boolean =>
    Math.abs(point.x - pad.center.x) <= pad.width / 2 + EPSILON &&
    Math.abs(point.y - pad.center.y) <= pad.height / 2 + EPSILON
  let outsideIndex = branch.points.length - 2
  while (
    outsideIndex >= branch.anchorIndex &&
    inside(getItemOrThrow(branch.points, outsideIndex))
  )
    outsideIndex--
  if (outsideIndex < branch.anchorIndex) return null
  if (getPathCost(branch.points.slice(outsideIndex)).bends !== 0) return null
  let runStart = outsideIndex
  while (runStart > branch.anchorIndex) {
    const previous = getItemOrThrow(branch.points, runStart - 1)
    if (
      getPathCost([previous, getItemOrThrow(branch.points, runStart), terminal])
        .bends !== 0
    )
      break
    runStart--
  }
  const outside = getItemOrThrow(branch.points, outsideIndex)
  const crossings: { side: PadSide; fraction: number }[] = []
  if (outside.x < pad.center.x - pad.width / 2)
    crossings.push({
      side: "left",
      fraction:
        (pad.center.x - pad.width / 2 - outside.x) / (terminal.x - outside.x),
    })
  if (outside.x > pad.center.x + pad.width / 2)
    crossings.push({
      side: "right",
      fraction:
        (pad.center.x + pad.width / 2 - outside.x) / (terminal.x - outside.x),
    })
  if (outside.y < pad.center.y - pad.height / 2)
    crossings.push({
      side: "bottom",
      fraction:
        (pad.center.y - pad.height / 2 - outside.y) / (terminal.y - outside.y),
    })
  if (outside.y > pad.center.y + pad.height / 2)
    crossings.push({
      side: "top",
      fraction:
        (pad.center.y + pad.height / 2 - outside.y) / (terminal.y - outside.y),
    })
  if (crossings.length === 0) return null
  const entryFraction = Math.max(
    ...crossings.map((crossing) => crossing.fraction),
  )
  const point = {
    x: outside.x + entryFraction * (terminal.x - outside.x),
    y: outside.y + entryFraction * (terminal.y - outside.y),
    z: terminal.z,
  }
  const originalAnchor = getItemOrThrow(branch.points, runStart)
  const dx = originalAnchor.x - terminal.x
  const dy = originalAnchor.y - terminal.y
  const fraction = Math.min(
    1,
    dx > EPSILON
      ? (bounds.maxX - terminal.x) / dx
      : dx < -EPSILON
        ? (bounds.minX - terminal.x) / dx
        : 1,
    dy > EPSILON
      ? (bounds.maxY - terminal.y) / dy
      : dy < -EPSILON
        ? (bounds.minY - terminal.y) / dy
        : 1,
  )
  const anchor = {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, terminal.x + fraction * dx)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, terminal.y + fraction * dy)),
    z: terminal.z,
  }
  const points = [...branch.points]
  let anchorIndex = runStart
  const localLength = Math.hypot(anchor.x - terminal.x, anchor.y - terminal.y)
  while (anchorIndex + 1 < points.length) {
    const next = getItemOrThrow(points, anchorIndex + 1)
    if (
      Math.hypot(next.x - terminal.x, next.y - terminal.y) <=
      localLength + EPSILON
    )
      break
    anchorIndex++
  }
  const existing = getItemOrThrow(points, anchorIndex)
  if (Math.hypot(existing.x - anchor.x, existing.y - anchor.y) > EPSILON) {
    anchorIndex++
    const next = getItemOrThrow(points, anchorIndex)
    if (Math.hypot(next.x - anchor.x, next.y - anchor.y) > EPSILON)
      points.splice(anchorIndex, 0, anchor)
  }
  return {
    branch: {
      ...branch,
      points,
      anchorIndex,
      anchor: getItemOrThrow(points, anchorIndex),
    },
    point,
    // Use the segment crossing the boundary, not earlier bends in the route.
    perpendicularToSide: crossings.some((crossing) =>
      Math.abs(crossing.fraction - entryFraction) < EPSILON &&
      (crossing.side === "left" || crossing.side === "right"
        ? Math.abs(terminal.y - outside.y) < EPSILON
        : Math.abs(terminal.x - outside.x) < EPSILON),
    ),
    sides: crossings
      .filter(
        (crossing) => Math.abs(crossing.fraction - entryFraction) < EPSILON,
      )
      .map((crossing) => crossing.side),
  }
}

/** Converging acute/right-angle entries may cross any pair of pad sides. */
export function entriesMatchPadJunctionPattern(
  first: PadTerminalEntry,
  second: PadTerminalEntry,
): boolean {
  if (first.perpendicularToSide && second.perpendicularToSide) return false
  const a = first.branch.terminal
  const b = second.branch.terminal
  if (Math.hypot(a.x - b.x, a.y - b.y) > PAD_TERMINAL_TOLERANCE) return false
  const cross =
    (first.point.x - a.x) * (second.point.y - b.y) -
    (first.point.y - a.y) * (second.point.x - b.x)
  if (Math.abs(cross) <= EPSILON) return false
  const dot =
    (first.point.x - a.x) * (second.point.x - b.x) +
    (first.point.y - a.y) * (second.point.y - b.y)
  return dot >= -EPSILON
}
