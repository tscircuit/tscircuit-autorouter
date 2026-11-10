import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { getPointKey } from "lib/utils/getPointKey"

type ConnectionName = SimpleRouteConnection["name"]

export type DifferentialPairInput = Pick<
  SimpleRouteJson,
  "connections" | "differentialPairs"
>

type DifferentialPairSectionPlan = {
  sectionsByMergedConnection: Map<ConnectionName, SimpleRouteConnection[]>
  sectionNamesByMember: Map<ConnectionName, ConnectionName[]>
}

export function planDifferentialPairSections(
  input: DifferentialPairInput | undefined,
  routingConnections: SimpleRouteConnection[],
  mergedConnections: SimpleRouteConnection[],
): DifferentialPairSectionPlan {
  const sectionsByMergedConnection = new Map<
    ConnectionName,
    SimpleRouteConnection[]
  >()
  const sectionNamesByMember = new Map<ConnectionName, ConnectionName[]>()
  if (!input?.differentialPairs?.length) {
    return { sectionsByMergedConnection, sectionNamesByMember }
  }

  const declaredByName = new Map(
    input.connections.map((connection) => [connection.name, connection]),
  )
  const routingByName = new Map(
    routingConnections.map((connection) => [connection.name, connection]),
  )
  const mergedByPoint = new Map(
    mergedConnections.flatMap((connection) =>
      connection.pointsToConnect.map((point) => [getPointKey(point), connection]),
    ),
  )
  const reservedNames = new Set([
    ...declaredByName.keys(),
    ...mergedConnections.map((connection) => connection.name),
  ])

  for (const pair of input.differentialPairs) {
    const [positiveName, negativeName] = pair.connectionNames
    const positive = declaredByName.get(positiveName)
    const negative = declaredByName.get(negativeName)
    if (!positive || !negative) continue
    const pointCount = positive.pointsToConnect.length
    const negativePointCount = negative.pointsToConnect.length
    const isInline = pointCount > 2 || negativePointCount > 2
    if (isInline && pointCount !== negativePointCount) {
      throw new Error(
        `Differential pair "${positiveName}/${negativeName}" needs the same number of ordered points on both members`,
      )
    }

    if (pointCount < 2 || negativePointCount < 2) continue
    const positiveGroup = mergedByPoint.get(
      getPointKey(positive.pointsToConnect[0]!),
    )
    const negativeGroup = mergedByPoint.get(
      getPointKey(negative.pointsToConnect[0]!),
    )
    if (!positiveGroup || !negativeGroup || positiveGroup === negativeGroup) {
      if (!isInline) continue
      throw new Error(
        `Differential pair "${positiveName}/${negativeName}" needs two distinct on-board paths`,
      )
    }

    for (const [member, merged] of [
      [positive, positiveGroup],
      [negative, negativeGroup],
    ] as const) {
      // A two-terminal member only needs a plan when merging added taps.
      if (
        merged.pointsToConnect.length <= 2 ||
        sectionNamesByMember.has(member.name)
      )
        continue
      const points = member.pointsToConnect
      if (new Set(points.map(getPointKey)).size !== points.length) {
        throw new Error(
          `Differential pair member "${member.name}" repeats a point in its ordered path`,
        )
      }
      const routingConnection = routingByName.get(member.name)
      if (!routingConnection) {
        throw new Error(
          `Differential pair member "${member.name}" has no on-board routing connection`,
        )
      }

      const sections = points.slice(1).map((point, index): SimpleRouteConnection => {
        let name = `${member.name}_pair_section${index}`
        while (reservedNames.has(name)) name += "_"
        reservedNames.add(name)
        return {
          ...routingConnection,
          name,
          pointsToConnect: [points[index]!, point],
          __rootConnectionNames: [
            ...new Set([
              ...(member.__rootConnectionNames?.length
                ? member.__rootConnectionNames
                : [member.name]),
              ...(merged.__rootConnectionNames ?? []),
            ]),
          ],
          __netConnectionName: merged.__netConnectionName,
        }
      })
      sectionNamesByMember.set(
        member.name,
        sections.map((section) => section.name),
      )
      sectionsByMergedConnection.set(merged.name, [
        ...(sectionsByMergedConnection.get(merged.name) ?? []),
        ...sections,
      ])
    }
  }

  return { sectionsByMergedConnection, sectionNamesByMember }
}
