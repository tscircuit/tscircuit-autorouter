import { isPointInRect } from "lib/utils/isPointInRect"

import type { Pad, TerminalPosition } from "./parsePadJunctionInput"
import { type PadJunctionContext } from "./padJunctionTypes"
export function findPadTerminals(
  context: PadJunctionContext,
  pad: Pad,
): [TerminalPosition, TerminalPosition] | null {
  if (
    pad.type !== "rect" ||
    pad.ccwRotationDegrees ||
    pad.isCopperPour ||
    ("shape" in pad && pad.shape !== undefined && pad.shape !== "rect")
  ) {
    return null
  }
  const found = new Map<number, TerminalPosition>()
  const visitedNets = new Set<string>()
  for (const identity of pad.connectedTo) {
    const net = context.getNet(identity)
    if (visitedNets.has(net)) continue
    visitedNets.add(net)
    const terminalPositions = context.terminalsByNet.get(net)
    if (!terminalPositions) continue
    for (const terminalPosition of terminalPositions) {
      const points = context.output[terminalPosition.routeIndex]!.route
      let index = 0
      let oppositeIndex = points.length - 1
      if (terminalPosition.index !== 0) {
        index = points.length - 1
        oppositeIndex = 0
      }
      const point = points[index]!
      if (!pad.__zLayers.includes(point.z) || !isPointInRect(point, pad))
        continue
      const opposite = points[oppositeIndex]!
      if (pad.__zLayers.includes(opposite.z) && isPointInRect(opposite, pad))
        continue
      found.set(terminalPosition.routeIndex, {
        routeIndex: terminalPosition.routeIndex,
        index,
      })
      if (found.size > 2) break
    }
    if (found.size > 2) break
  }
  if (found.size !== 2) return null
  return [...found.values()] as [TerminalPosition, TerminalPosition]
}
