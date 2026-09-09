import {
  EPSILON,
  RunDirection,
  type Point,
  type Run,
  type CutRun,
  type PadJunctionContext,
} from "./padJunctionTypes"
export function cutTerminalRun(
  context: PadJunctionContext,
  run: Run,
  axis: "x" | "y",
  sign: number,
  height: number,
): CutRun | null {
  const fraction =
    (sign * height - run.terminal[axis]) /
    (run.start[axis] - run.terminal[axis])
  if (fraction <= 0 || fraction > 1 + EPSILON) return null
  const cut: Point = {
    x: run.terminal.x + fraction * (run.start.x - run.terminal.x),
    y: run.terminal.y + fraction * (run.start.y - run.terminal.y),
    z: run.terminal.z,
  }
  const points = context.output[run.routeIndex]!.route
  let cutIndex = run.startIndex
  while (
    cutIndex - run.direction !== run.index &&
    sign * points[cutIndex - run.direction]![axis] >= height - EPSILON
  )
    cutIndex -= run.direction
  let preserved: Point[]
  switch (run.direction) {
    case RunDirection.TowardRouteStart:
      preserved = points.slice(0, cutIndex + 1)
      break
    case RunDirection.TowardRouteEnd:
      preserved = points.slice(cutIndex).reverse()
      break
  }
  if (
    Math.hypot(preserved.at(-1)!.x - cut.x, preserved.at(-1)!.y - cut.y) >
    EPSILON
  )
    preserved.push(cut)
  return { ...run, cut, preserved }
}
