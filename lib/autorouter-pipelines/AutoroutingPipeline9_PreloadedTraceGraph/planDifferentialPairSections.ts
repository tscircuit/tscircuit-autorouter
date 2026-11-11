import type {
  ConnectionPoint,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { getPointKey } from "lib/utils/getPointKey"

type ConnectionName = SimpleRouteConnection["name"]

type DifferentialPairSectionPlan = {
  sectionsByMergedConnection: Map<ConnectionName, SimpleRouteConnection[]>
  sectionNamesByMember: Map<ConnectionName, ConnectionName[]>
}

function getDifferentialPairPathPoints(
  connection: SimpleRouteConnection,
): ConnectionPoint[] {
  const { name, path, pointsToConnect } = connection
  if (!path) {
    if (pointsToConnect.length > 2) {
      throw new Error(
        `Differential pair member "${name}" needs a path for its ${pointsToConnect.length} points`,
      )
    }
    return pointsToConnect
  }
  if (path.length < 2 || new Set(path).size !== path.length) {
    throw new Error(
      `Differential pair member "${name}" needs at least two distinct point IDs in its path`,
    )
  }
  return path.map((pointId) => {
    const matchingPoints = pointsToConnect.filter(
      (point) => point.pointId === pointId,
    )
    if (matchingPoints.length !== 1) {
      throw new Error(
        `Differential pair member "${name}" path point "${pointId}" must identify exactly one point in pointsToConnect`,
      )
    }
    return matchingPoints[0]!
  })
}

export function planDifferentialPairSections(
  srjBeforeEscapeVias: SimpleRouteJson,
  routingConnections: SimpleRouteConnection[],
  mergedConnections: SimpleRouteConnection[],
): DifferentialPairSectionPlan {
  const sectionsByMergedConnection = new Map<
    ConnectionName,
    SimpleRouteConnection[]
  >()
  const sectionNamesByMember = new Map<ConnectionName, ConnectionName[]>()
  const pairs = srjBeforeEscapeVias.differentialPairs
  if (!pairs?.length) {
    return { sectionsByMergedConnection, sectionNamesByMember }
  }

  // Escape vias can add routing points that are not part of the declared pair.
  const declaredByName = new Map(
    srjBeforeEscapeVias.connections.map((connection) => [
      connection.name,
      connection,
    ]),
  )
  const routingByName = new Map(
    routingConnections
      .filter((connection) => !connection.isOffBoard)
      .map((connection) => [connection.name, connection]),
  )
  const mergedByPoint = new Map(
    mergedConnections.flatMap((connection) =>
      connection.pointsToConnect.map((point) => [
        getPointKey(point),
        connection,
      ]),
    ),
  )
  const reservedNames = new Set([
    ...declaredByName.keys(),
    ...mergedConnections.map((connection) => connection.name),
  ])

  for (const pair of pairs) {
    const [positiveName, negativeName] = pair.connectionNames
    const positive = declaredByName.get(positiveName)
    const negative = declaredByName.get(negativeName)
    if (!positive || !negative) continue
    const positivePoints = getDifferentialPairPathPoints(positive)
    const negativePoints = getDifferentialPairPathPoints(negative)
    const pointCount = positivePoints.length
    const negativePointCount = negativePoints.length
    const isInline = pointCount > 2 || negativePointCount > 2
    if (isInline && pointCount !== negativePointCount) {
      throw new Error(
        `Differential pair "${positiveName}/${negativeName}" needs the same number of ordered points on both members`,
      )
    }

    if (pointCount < 2 || negativePointCount < 2) continue
    const positiveGroup = mergedByPoint.get(getPointKey(positivePoints[0]!))
    const negativeGroup = mergedByPoint.get(getPointKey(negativePoints[0]!))
    if (!positiveGroup || !negativeGroup || positiveGroup === negativeGroup) {
      if (!isInline) continue
      throw new Error(
        `Differential pair "${positiveName}/${negativeName}" needs two distinct on-board paths`,
      )
    }

    for (const [member, merged, points] of [
      [positive, positiveGroup, positivePoints],
      [negative, negativeGroup, negativePoints],
    ] as const) {
      // A two-terminal member only needs a plan when merging added taps.
      if (
        merged.pointsToConnect.length <= 2 ||
        sectionNamesByMember.has(member.name)
      )
        continue
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
      const { path, ...sectionConnection } = routingConnection
      let nominalTraceWidth = routingConnection.nominalTraceWidth
      for (const bus of srjBeforeEscapeVias.buses ?? []) {
        if (
          bus.traceWidth !== undefined &&
          bus.connectionNames.includes(member.name)
        ) {
          nominalTraceWidth = Math.max(nominalTraceWidth ?? 0, bus.traceWidth)
        }
      }

      const sections = points
        .slice(1)
        .map((point, index): SimpleRouteConnection => {
          let name = `${member.name}_pair_section${index}`
          while (reservedNames.has(name)) name += "_"
          reservedNames.add(name)
          return {
            ...sectionConnection,
            name,
            nominalTraceWidth,
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
