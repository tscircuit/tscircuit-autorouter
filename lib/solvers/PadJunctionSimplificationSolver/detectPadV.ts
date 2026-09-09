import type { Pad, TerminalPosition } from "./parsePadJunctionInput"
import {
  EPSILON,
  TERMINAL_TOLERANCE,
  type PadJunctionOutcome,
  type PadJunctionContext,
  type PadV,
} from "./padJunctionTypes"
import { getTerminalRun } from "./getTerminalRun"
export function detectPadV(
  context: PadJunctionContext,
  pad: Pad,
  terminalPositions: [TerminalPosition, TerminalPosition],
): PadV | PadJunctionOutcome {
  const connectionNames = terminalPositions.map(
    ({ routeIndex }) => context.output[routeIndex]!.connectionName,
  )
  const unsupported: PadJunctionOutcome = {
    outcome: "unsupported",
    reason: "Requires two straight runs forming a V around a cardinal stem",
    connectionNames,
  }
  if (
    terminalPositions.some(({ routeIndex }) =>
      context.lockedRoutes.has(routeIndex),
    )
  )
    return unsupported
  const first = getTerminalRun(context, terminalPositions[0], pad)
  const second = getTerminalRun(context, terminalPositions[1], pad)
  if (!first || !second) return unsupported
  const width = context.output[first.routeIndex]!.traceThickness
  if (
    context.output[second.routeIndex]!.traceThickness !== width ||
    first.terminal.z !== second.terminal.z ||
    pad.width <= width ||
    pad.height <= width ||
    Math.hypot(
      first.terminal.x - second.terminal.x,
      first.terminal.y - second.terminal.y,
    ) > TERMINAL_TOLERANCE
  )
    return unsupported
  const ax = first.start.x - first.terminal.x
  const ay = first.start.y - first.terminal.y
  const bx = second.start.x - second.terminal.x
  const by = second.start.y - second.terminal.y
  if (ax * bx + ay * by < -EPSILON) return unsupported
  let axis: "x" | "y"
  let across: "x" | "y"
  if (ay * by > EPSILON && ax * bx < -EPSILON) {
    axis = "y"
    across = "x"
  } else if (ax * bx > EPSILON && ay * by < -EPSILON) {
    axis = "x"
    across = "y"
  } else {
    return unsupported
  }
  const sign = Math.sign(first.start[axis] - first.terminal[axis])
  return {
    pad,
    runs: [first, second],
    width,
    axis,
    across,
    sign,
    connectionNames,
    unsupported,
  }
}
