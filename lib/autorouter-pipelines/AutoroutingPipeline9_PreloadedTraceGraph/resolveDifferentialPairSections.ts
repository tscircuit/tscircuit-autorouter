import type { DifferentialPair as LengthMatchingPair } from "@tscircuit/length-matching-solver"
import type {
  ConnectionPoint,
  DifferentialPair,
  SimpleRouteConnection,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getPointKey } from "lib/utils/getPointKey"

type Terminal = NonNullable<LengthMatchingPair["terminalPairs"]>[number][number]

export function resolveDifferentialPairSections(
  pairs: DifferentialPair[],
  pointPairs: SimpleRouteConnection[],
  sectionNamesByMember: ReadonlyMap<string, string[]>,
  hdRoutes: HighDensityRoute[],
): LengthMatchingPair[] {
  if (pairs.length === 0) return []

  const pointPairsByName = new Map(
    pointPairs.map((connection) => [connection.name, connection]),
  )
  const routedNames = new Set(hdRoutes.map((route) => route.connectionName))
  const routedConnectionsByPoint = new Map<string, string[]>()
  for (const connection of pointPairs) {
    if (!routedNames.has(connection.name)) continue
    for (const point of connection.pointsToConnect) {
      const key = getPointKey(point)
      const connections = routedConnectionsByPoint.get(key) ?? []
      connections.push(connection.name)
      routedConnectionsByPoint.set(key, connections)
    }
  }

  const resolveMember = (name: string): string[] => {
    const sectionNames = sectionNamesByMember.get(name)
    if (sectionNames) return sectionNames

    const matches = pointPairs.filter(
      (connection) =>
        connection.name === name ||
        connection.__rootConnectionNames?.includes(name) ||
        connection.__netConnectionName === name,
    )
    if (matches.length !== 1) {
      throw new Error(
        `Pipeline9: differential pair connection "${name}" must resolve to exactly one final point-pair connection, got ${matches.length}`,
      )
    }
    return [matches[0]!.name]
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

  return pairs.flatMap((pair) => {
    const positiveSections = resolveMember(pair.connectionNames[0])
    const negativeSections = resolveMember(pair.connectionNames[1])
    if (positiveSections.length !== negativeSections.length) {
      throw new Error(
        `Pipeline9: differential pair ${pair.connectionNames.join("/")} resolves to different section counts`,
      )
    }

    return positiveSections.map(
      (positiveSection, index): LengthMatchingPair => {
        const negativeSection = negativeSections[index]!
        if (positiveSection === negativeSection) {
          throw new Error(
            `Pipeline9: differential pair ${pair.connectionNames.join("/")} resolves both members to "${positiveSection}"`,
          )
        }

        const section: LengthMatchingPair = {
          connectionNames: [positiveSection, negativeSection],
          // Bounding each section's skew bounds the sum along the whole path.
          lengthTolerance: pair.lengthTolerance / positiveSections.length,
        }
        const [positiveStart, positiveEnd] = getEndpoints(positiveSection)
        let [negativeStart, negativeEnd] = getEndpoints(negativeSection)
        if (positiveSections.length === 1) {
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
        const terminal = (point: ConnectionPoint): Terminal => ({
          x: point.x,
          y: point.y,
          connectedTo: (
            routedConnectionsByPoint.get(getPointKey(point)) ?? []
          ).filter((name) => !section.connectionNames.includes(name)),
        })
        const terminalPairs: NonNullable<LengthMatchingPair["terminalPairs"]> =
          [
            [terminal(positiveStart), terminal(negativeStart)],
            [terminal(positiveEnd), terminal(negativeEnd)],
          ]
        if (
          positiveSections.length > 1 ||
          terminalPairs.flat().some((point) => point.connectedTo.length > 0)
        ) {
          section.terminalPairs = terminalPairs
        }
        if (pair.maxUncoupledLength !== undefined) {
          section.maxUncoupledLength = pair.maxUncoupledLength
        }
        if (pair.traceGap === undefined) return section

        const halfWidths = section.connectionNames.map((name) => {
          const matchingRoutes = hdRoutes.filter(
            (route) => route.connectionName === name,
          )
          if (matchingRoutes.length !== 1) {
            throw new Error(
              `Pipeline9: differential pair connection "${name}" must resolve to exactly one final HD route, got ${matchingRoutes.length}`,
            )
          }
          return matchingRoutes[0]!.traceThickness / 2
        })
        const centerlineDistance =
          pair.traceGap + halfWidths[0]! + halfWidths[1]!
        section.minimumCenterlineDistance = centerlineDistance
        section.maximumCenterlineDistance = centerlineDistance
        return section
      },
    )
  })
}
