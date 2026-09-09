import { checkTraceClearance } from "./checkTraceClearance"
import { checkViaClearance } from "./checkViaClearance"
import {
  type Point,
  type PadJunctionContext,
  type PadT,
} from "./padJunctionTypes"
export function checkCopperClearance(
  context: PadJunctionContext,
  t: PadT,
  segments: [Point, Point][],
  nets: Set<string>,
): string | null {
  const { runs } = t
  const allRoutes = [...context.output, ...(context.input.otherHdRoutes ?? [])]
  for (const [routeIndex, route] of allRoutes.entries()) {
    const sameNet =
      nets.has(context.getNet(route.connectionName)) ||
      (route.rootConnectionName !== undefined &&
        nets.has(context.getNet(route.rootConnectionName)))
    const run = runs.find((candidate) => candidate.routeIndex === routeIndex)
    let points = route.route
    if (run) points = run.preserved
    const traceError = checkTraceClearance(
      context,
      t,
      segments,
      sameNet,
      route,
      points,
    )
    if (traceError) return traceError
    const viaError = checkViaClearance(context, t, segments, sameNet, route)
    if (viaError) return viaError
  }
  return null
}
