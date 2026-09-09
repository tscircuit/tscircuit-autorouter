import {
  RunDirection,
  type PadJunctionOutcome,
  type PadJunctionContext,
  type PadT,
} from "./padJunctionTypes"
export function applyPadT(
  context: PadJunctionContext,
  t: PadT,
): PadJunctionOutcome {
  const { junction } = t.replacement
  for (const run of t.runs) {
    const points = [...run.preserved, junction, run.terminal]
    if (run.direction === RunDirection.TowardRouteEnd) points.reverse()
    context.output[run.routeIndex] = {
      ...context.output[run.routeIndex]!,
      route: points,
    }
    context.lockedRoutes.add(run.routeIndex)
  }
  return {
    outcome: "accepted",
    reason: "Replaced V with a straight head and perpendicular stem",
    connectionNames: t.v.connectionNames,
  }
}
