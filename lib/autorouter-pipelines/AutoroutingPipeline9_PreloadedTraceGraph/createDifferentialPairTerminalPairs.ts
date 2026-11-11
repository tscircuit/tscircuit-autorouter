import type { DifferentialPair } from "@tscircuit/length-matching-solver"
import type { ConnectionPoint, SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getPointKey } from "lib/utils/getPointKey"

type TerminalPairs = NonNullable<DifferentialPair["terminalPairs"]>

export function createDifferentialPairTerminalPairs(
  connections: SimpleRouteConnection[],
  hdRoutes: HighDensityRoute[],
): (
  connectionNames: [string, string],
  isInline: boolean,
) => TerminalPairs | undefined {
  const pointPairsByName = new Map<string, SimpleRouteConnection>()
  const routedNames = new Set(hdRoutes.map((route) => route.connectionName))
  const routedConnectionsByPoint = new Map<string, string[]>()
  for (const connection of connections) {
    pointPairsByName.set(connection.name, connection)
    if (!routedNames.has(connection.name)) continue
    for (const point of connection.pointsToConnect) {
      const key = getPointKey(point)
      const attachedConnections = routedConnectionsByPoint.get(key) ?? []
      attachedConnections.push(connection.name)
      routedConnectionsByPoint.set(key, attachedConnections)
    }
  }

  const getEndpoints = (name: string): [ConnectionPoint, ConnectionPoint] => {
    const points = pointPairsByName.get(name)?.pointsToConnect
    if (points?.length !== 2) {
      throw new Error(
        `Pipeline9: differential pair section "${name}" needs two terminal points`,
      )
    }
    return [points[0]!, points[1]!]
  }

  return (connectionNames, isInline) => {
    const [positiveStart, positiveEnd] = getEndpoints(connectionNames[0])
    let [negativeStart, negativeEnd] = getEndpoints(connectionNames[1])
    if (!isInline) {
      // Preserve the terminal alignment of two-point pairs without a path.
      const distance = (a: ConnectionPoint, b: ConnectionPoint): number =>
        Math.hypot(a.x - b.x, a.y - b.y)
      const forward =
        distance(positiveStart, negativeStart) +
        distance(positiveEnd, negativeEnd)
      const reverse =
        distance(positiveStart, negativeEnd) +
        distance(positiveEnd, negativeStart)
      if (reverse + 1e-8 < forward) {
        const start = negativeStart
        negativeStart = negativeEnd
        negativeEnd = start
      }
    }
    const terminal = (
      point: ConnectionPoint,
    ): TerminalPairs[number][number] => ({
      x: point.x,
      y: point.y,
      connectedTo: (
        routedConnectionsByPoint.get(getPointKey(point)) ?? []
      ).filter((name) => !connectionNames.includes(name)),
    })
    const terminalPairs: TerminalPairs = [
      [terminal(positiveStart), terminal(negativeStart)],
      [terminal(positiveEnd), terminal(negativeEnd)],
    ]
    if (
      isInline ||
      terminalPairs.flat().some((point) => point.connectedTo.length > 0)
    ) {
      return terminalPairs
    }
    return undefined
  }
}
