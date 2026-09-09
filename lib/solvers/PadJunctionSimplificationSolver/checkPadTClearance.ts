import {
  type Point,
  type PadJunctionContext,
  type PadT,
} from "./padJunctionTypes"
import { checkPadClearance } from "./checkPadClearance"
import { checkCopperClearance } from "./checkCopperClearance"
import { checkBoardClearance } from "./checkBoardClearance"
export function checkPadTClearance(
  context: PadJunctionContext,
  t: PadT,
): string | null {
  const { runs, replacement } = t
  const { junction } = replacement
  const segments: [Point, Point][] = [
    [runs[0].cut, runs[1].cut],
    [junction, runs[0].terminal],
    [junction, runs[1].terminal],
  ]
  const firstRoute = context.output[runs[0].routeIndex]!
  const nets = new Set([context.getNet(firstRoute.connectionName)])
  if (firstRoute.rootConnectionName)
    nets.add(context.getNet(firstRoute.rootConnectionName))
  return (
    checkPadClearance(context, t, segments, nets) ??
    checkCopperClearance(context, t, segments, nets) ??
    checkBoardClearance(context, t.v.width, segments)
  )
}
