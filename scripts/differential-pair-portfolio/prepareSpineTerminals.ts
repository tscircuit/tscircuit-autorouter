import type { ParsedTrace } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/model/internal-types"
import type { CandidateGeometryContext } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/geometry/validateCandidateGeometry"
import { createSearchGeometryValidator } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/geometry/createSearchGeometryValidator"
import { resolveTerminalFanoutStation } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/routing/resolveTerminalFanoutStation"
import type { CoupledPathPoint } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/routing/types"

export type PrepareSpineTerminalsInput = {
  first: ParsedTrace
  second: ParsedTrace
  reverseSecond: boolean
  context: CandidateGeometryContext
  centerlineSpacing: number
  maxUncoupledLength?: number
  side?: 1 | -1
  searchStep?: number
}
export type PreparedSpineTerminals =
  | {
      status: "ready"
      start: CoupledPathPoint
      end: CoupledPathPoint
      side: 1 | -1
    }
  | { status: "rejected"; reason: string }

/** Resolve real terminal escape copper before asking a thick-spine router for a corridor. */
export function prepareSpineTerminals(
  input: PrepareSpineTerminalsInput,
): PreparedSpineTerminals {
  if (!Number.isFinite(input.centerlineSpacing) || input.centerlineSpacing <= 0)
    throw new Error("Spine centerline spacing must be positive and finite")
  if (
    input.maxUncoupledLength !== undefined &&
    (!Number.isFinite(input.maxUncoupledLength) || input.maxUncoupledLength < 0)
  )
    throw new Error(
      "Spine terminal escape budget must be nonnegative and finite",
    )
  const firstStart = input.first.points[0],
    firstEnd = input.first.points.at(-1)
  const secondStart = input.reverseSecond
    ? input.second.points.at(-1)
    : input.second.points[0]
  const secondEnd = input.reverseSecond
    ? input.second.points[0]
    : input.second.points.at(-1)
  if (!firstStart || !firstEnd || !secondStart || !secondEnd)
    throw new Error(
      "Spine terminal preparation requires nonempty parsed pair members",
    )
  if (
    firstStart.layer !== secondStart.layer ||
    firstEnd.layer !== secondEnd.layer
  )
    return {
      status: "rejected",
      reason: "Pair members do not share terminal station layers",
    }
  const start = {
    x: (firstStart.x + secondStart.x) / 2,
    y: (firstStart.y + secondStart.y) / 2,
    layer: firstStart.layer,
  }
  const end = {
    x: (firstEnd.x + secondEnd.x) / 2,
    y: (firstEnd.y + secondEnd.y) / 2,
    layer: firstEnd.layer,
  }
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (length < 1e-7)
    return { status: "rejected", reason: "Terminal station midpoints coincide" }
  const direction = {
    x: (end.x - start.x) / length,
    y: (end.y - start.y) / length,
  }
  const normal = { x: -direction.y, y: direction.x }
  const side =
    input.side ??
    ((firstStart.x - secondStart.x) * normal.x +
      (firstStart.y - secondStart.y) * normal.y >=
    0
      ? 1
      : -1)
  const validator = createSearchGeometryValidator({
    ...input.context,
    start,
    end,
    firstConnectionName: input.first.source.connection_name,
    secondConnectionName: input.second.source.connection_name,
    firstStartTerminal: firstStart,
    firstEndTerminal: firstEnd,
    secondStartTerminal: secondStart,
    secondEndTerminal: secondEnd,
    firstWidth: input.first.width,
    secondWidth: input.second.width,
    firstViaDiameter: input.first.viaDiameter,
    secondViaDiameter: input.second.viaDiameter,
    centerlineSpacing: input.centerlineSpacing,
    side,
    terminalFanout: false,
    terminalMiterMargin: input.centerlineSpacing / 2,
  })
  const resolvedStart = resolveTerminalFanoutStation({
    anchor: start,
    escapeDirection: direction,
    pathDirection: direction,
    centerlineSpacing: input.centerlineSpacing,
    side,
    lanes: [
      { point: firstStart, polarity: 1 },
      { point: secondStart, polarity: -1 },
    ],
    maxUncoupledLength: input.maxUncoupledLength,
    maximumTurnDegrees: 55,
    searchStep: input.searchStep ?? 0.25,
    isValid: (station) =>
      validator.isTerminalFanoutValid(station, direction, "start"),
  })
  const resolvedEnd = resolveTerminalFanoutStation({
    anchor: end,
    escapeDirection: { x: -direction.x, y: -direction.y },
    pathDirection: direction,
    centerlineSpacing: input.centerlineSpacing,
    side,
    lanes: [
      { point: firstEnd, polarity: 1 },
      { point: secondEnd, polarity: -1 },
    ],
    maxUncoupledLength: input.maxUncoupledLength,
    maximumTurnDegrees: 45,
    searchStep: input.searchStep ?? 0.25,
    isValid: (station) =>
      validator.isTerminalFanoutValid(station, direction, "end"),
  })
  if (!resolvedStart || !resolvedEnd)
    return {
      status: "rejected",
      reason:
        "No clearance-safe terminal escape station within the declared budget",
    }
  const coupledTravel =
    (resolvedEnd.x - resolvedStart.x) * direction.x +
    (resolvedEnd.y - resolvedStart.y) * direction.y
  if (coupledTravel <= 1e-7)
    return {
      status: "rejected",
      reason: "Terminal escape stations leave no forward coupled corridor",
    }
  return { status: "ready", start: resolvedStart, end: resolvedEnd, side }
}
