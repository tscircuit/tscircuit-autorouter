import { isPointInRect } from "lib/utils/isPointInRect"

import type { Pad, TerminalPosition } from "./parsePadJunctionInput"
import {
  EPSILON,
  RunDirection,
  type Run,
  type PadJunctionContext,
} from "./padJunctionTypes"
export function getTerminalRun(
  context: PadJunctionContext,
  terminalPosition: TerminalPosition,
  pad: Pad,
): Run | null {
  const route = context.output[terminalPosition.routeIndex]!
  const points = route.route
  const terminal = points[terminalPosition.index]!
  let direction = RunDirection.TowardRouteStart
  if (terminalPosition.index === 0) direction = RunDirection.TowardRouteEnd
  let startIndex = terminalPosition.index + direction
  while (
    startIndex >= 0 &&
    startIndex < points.length &&
    points[startIndex]!.z === terminal.z &&
    Math.hypot(
      points[startIndex]!.x - terminal.x,
      points[startIndex]!.y - terminal.y,
    ) < EPSILON
  )
    startIndex += direction
  if (startIndex < 0 || startIndex >= points.length) return null
  const first = points[startIndex]!
  const dx = first.x - terminal.x
  const dy = first.y - terminal.y
  while (
    startIndex + direction >= 0 &&
    startIndex + direction < points.length
  ) {
    const next = points[startIndex + direction]!
    const previous = points[startIndex]!
    if (
      next.z !== terminal.z ||
      Math.abs(dx * (next.y - terminal.y) - dy * (next.x - terminal.x)) >
        EPSILON ||
      dx * (next.x - previous.x) + dy * (next.y - previous.y) <= EPSILON
    )
      break
    startIndex += direction
  }
  const start = points[startIndex]!
  if (
    start.z !== terminal.z ||
    isPointInRect(start, pad) ||
    route.jumpers?.length
  )
    return null
  for (
    let index = terminalPosition.index;
    index !== startIndex + direction;
    index += direction
  ) {
    const point = points[index]!
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
      throw new Error(
        `PadJunctionSimplificationSolver: invalid run "${route.connectionName}"`,
      )
    if (
      point.insideJumperPad ||
      point.toNextSegmentType ||
      point.toNextSegmentCircuitJsonMetadata ||
      (index !== terminalPosition.index &&
        index !== startIndex &&
        point.pcb_port_id) ||
      (point.traceThickness !== undefined &&
        point.traceThickness !== route.traceThickness)
    )
      return null
  }
  return { ...terminalPosition, terminal, start, startIndex, direction }
}
