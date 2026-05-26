import type { PortPoint } from "lib/types/high-density-types"

const getPairKey = (a: PortPoint, b: PortPoint) => {
  const aKey = a.portPointId ?? `${a.connectionName}:${a.x}:${a.y}:${a.z}`
  const bKey = b.portPointId ?? `${b.connectionName}:${b.x}:${b.y}:${b.z}`
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
}

export const getConnectionPortPointPairs = (
  portPoints: PortPoint[],
): Array<[PortPoint, PortPoint]> => {
  const pairs: Array<[PortPoint, PortPoint]> = []
  const seenPairKeys = new Set<string>()
  const portPointsById = new Map(
    portPoints
      .filter(
        (portPoint): portPoint is PortPoint & { portPointId: string } =>
          typeof portPoint.portPointId === "string",
      )
      .map((portPoint) => [portPoint.portPointId, portPoint] as const),
  )

  const addPair = (a: PortPoint, b: PortPoint) => {
    if (a === b) return
    const pairKey = getPairKey(a, b)
    if (seenPairKeys.has(pairKey)) return
    seenPairKeys.add(pairKey)
    pairs.push([a, b])
  }

  for (const portPoint of portPoints) {
    if (portPoint.prevPortPointId) {
      const prev = portPointsById.get(portPoint.prevPortPointId)
      if (prev && prev.connectionName === portPoint.connectionName) {
        addPair(prev, portPoint)
      }
    }
    if (portPoint.nextPortPointId) {
      const next = portPointsById.get(portPoint.nextPortPointId)
      if (next && next.connectionName === portPoint.connectionName) {
        addPair(portPoint, next)
      }
    }
  }

  if (pairs.length === 0) {
    for (let i = 0; i < portPoints.length - 1; i++) {
      addPair(portPoints[i]!, portPoints[i + 1]!)
    }
    return pairs
  }

  const linkedIds = new Set(
    pairs.flatMap(([a, b]) => [a.portPointId, b.portPointId]).filter(Boolean),
  )
  const unlinkedPortPoints = portPoints.filter(
    (portPoint) =>
      !portPoint.portPointId || !linkedIds.has(portPoint.portPointId),
  )

  for (let i = 0; i < unlinkedPortPoints.length - 1; i++) {
    addPair(unlinkedPortPoints[i]!, unlinkedPortPoints[i + 1]!)
  }

  return pairs
}
