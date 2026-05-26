import type { PortPoint } from "lib/types/high-density-types"

type PortPointPair = [PortPoint, PortPoint]

/**
 * Returns a stable identifier for a port point.
 *
 * @param portPoint - Port point to serialize for pair matching.
 * @returns `portPointId` when available, otherwise a coordinate-based fallback.
 * @note The fallback key is only intended for local pair construction.
 */
const getPortPointKey = (portPoint: PortPoint) =>
  portPoint.portPointId ??
  `${portPoint.connectionName}:${portPoint.x}:${portPoint.y}:${portPoint.z}`

/**
 * Builds an order-independent pair key.
 *
 * @param pair - Pair of port points to normalize.
 * @returns Stable string key shared by `A-B` and `B-A`.
 */
const getPairKey = (pair: PortPointPair) => {
  const [a, b] = pair
  const aKey = getPortPointKey(a)
  const bKey = getPortPointKey(b)
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
}

/**
 * Adds a pair when it is unique and not self-referential.
 *
 * @param pair - Candidate pair to append.
 * @param context - Mutable pair-building state.
 * @returns `true` when the pair was appended.
 */
const addUniquePair = (
  pair: PortPointPair,
  context: {
    pairs: PortPointPair[]
    seenPairKeys: Set<string>
  },
) => {
  const [a, b] = pair
  if (a === b) return false
  const pairKey = getPairKey(pair)
  if (context.seenPairKeys.has(pairKey)) return false
  context.seenPairKeys.add(pairKey)
  context.pairs.push(pair)
  return true
}

/**
 * Connects port points in their existing order.
 *
 * @param portPoints - Port points to connect sequentially.
 * @param context - Mutable pair-building state.
 * @returns Nothing. The function mutates `context.pairs`.
 */
const addSequentialPairs = (
  portPoints: PortPoint[],
  context: {
    pairs: PortPointPair[]
    seenPairKeys: Set<string>
  },
) => {
  for (let index = 0; index < portPoints.length - 1; index++) {
    addUniquePair([portPoints[index]!, portPoints[index + 1]!], context)
  }
}

/**
 * Builds the route segments for one connection's port points.
 *
 * @param portPoints - All port points belonging to a single connection.
 * @returns Ordered route pairs ready for intra-node solving.
 * @note Explicit `prevPortPointId` / `nextPortPointId` links take precedence.
 * Any leftover unlinked points are paired sequentially as a fallback.
 */
export const getConnectionPortPointPairs = (
  portPoints: PortPoint[],
): PortPointPair[] => {
  const pairs: PortPointPair[] = []
  const seenPairKeys = new Set<string>()
  const portPointsById = new Map(
    portPoints
      .filter(
        (portPoint): portPoint is PortPoint & { portPointId: string } =>
          typeof portPoint.portPointId === "string",
      )
      .map((portPoint) => [portPoint.portPointId, portPoint] as const),
  )
  const pairCollection = { pairs, seenPairKeys }

  for (const portPoint of portPoints) {
    if (portPoint.prevPortPointId) {
      const prev = portPointsById.get(portPoint.prevPortPointId)
      if (prev && prev.connectionName === portPoint.connectionName) {
        addUniquePair([prev, portPoint], pairCollection)
      }
    }
    if (portPoint.nextPortPointId) {
      const next = portPointsById.get(portPoint.nextPortPointId)
      if (next && next.connectionName === portPoint.connectionName) {
        addUniquePair([portPoint, next], pairCollection)
      }
    }
  }

  if (pairs.length === 0) {
    addSequentialPairs(portPoints, pairCollection)
    return pairs
  }

  const linkedIds = new Set(
    pairs.flatMap(([a, b]) => [a.portPointId, b.portPointId]).filter(Boolean),
  )
  const unlinkedPortPoints = portPoints.filter(
    (portPoint) =>
      !portPoint.portPointId || !linkedIds.has(portPoint.portPointId),
  )

  addSequentialPairs(unlinkedPortPoints, pairCollection)

  return pairs
}
