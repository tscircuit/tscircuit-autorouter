import {
  EPSILON,
  type Point,
  type AcceptedReplacement,
  type PadJunctionOutcome,
  type PadJunctionContext,
  type PadV,
  type PadT,
} from "./padJunctionTypes"
import { cutTerminalRun } from "./cutTerminalRun"
export function constructPadT(
  context: PadJunctionContext,
  v: PadV,
): PadT | PadJunctionOutcome {
  const { pad, runs, width, axis, across, sign, connectionNames, unsupported } =
    v
  const terminal = runs[0].terminal
  let padSize = pad.height
  if (axis === "x") padSize = pad.width
  const gap = width / 2
  let height = sign * pad.center[axis] + padSize / 2 + width / 2 + gap
  // Move the head only as far as needed to give both arms one trace width.
  for (const run of runs) {
    const slope =
      (run.start[across] - run.terminal[across]) /
      (sign * (run.start[axis] - run.terminal[axis]))
    height = Math.max(
      height,
      sign * run.terminal[axis] +
        (width - Math.sign(slope) * (run.terminal[across] - terminal[across])) /
          Math.abs(slope),
    )
  }
  const junction: Point = {
    x: terminal.x,
    y: terminal.y,
    z: terminal.z,
    [axis]: sign * height,
  }
  const left = cutTerminalRun(context, runs[0], axis, sign, height)
  const right = cutTerminalRun(context, runs[1], axis, sign, height)
  if (!left || !right)
    return {
      outcome: "no_path",
      reason: "Insufficient straight-run room for the head gap",
      connectionNames,
    }
  const leftLength = Math.abs(left.cut[across] - junction[across])
  const rightLength = Math.abs(right.cut[across] - junction[across])
  if (
    Math.min(leftLength, rightLength) <
    (leftLength + rightLength) / 4 - EPSILON
  )
    return unsupported
  const oldLength =
    Math.hypot(left.cut.x - left.terminal.x, left.cut.y - left.terminal.y) +
    Math.hypot(right.cut.x - right.terminal.x, right.cut.y - right.terminal.y)
  const newLength =
    leftLength + rightLength + Math.abs(junction[axis] - terminal[axis])
  if (newLength > oldLength * 1.1 + EPSILON)
    return {
      outcome: "no_improvement",
      reason: "Head and stem exceed 10% copper growth",
      connectionNames,
    }
  const replacement: AcceptedReplacement = {
    junction,
    head: [left.cut, right.cut],
    stem: [junction, terminal],
  }
  return { v, runs: [left, right], replacement }
}
