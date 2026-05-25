import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getExplicitPortPointPairIds } from "./getExplicitPortPointPairIds"
import { getPortPointPairKey } from "./getPortPointPairKey"
import type { NodePortPointPair } from "./types"

type IndexedPortPoint = {
  index: number
  portPoint: PortPoint
}

/**
 * Resolves the concrete port-point pairs for a node.
 *
 * @param nodeWithPortPoints - Node whose port points should be paired.
 * @returns Ordered port-point pairs for the node.
 * @note Explicit pair ids are applied first. Any remaining unpaired points are
 * then paired in encounter order within each `connectionName`.
 * @caution Invalid explicit pairs are skipped when ids are missing, duplicated,
 * self-referential, or cross connection boundaries.
 */
export const getNodePortPointPairs = (
  nodeWithPortPoints: NodeWithPortPoints,
): NodePortPointPair[] => {
  const indexedPortPoints = nodeWithPortPoints.portPoints.map(
    (portPoint, index) => ({ index, portPoint }),
  )
  const indexedPortPointById = new Map<string, IndexedPortPoint | null>()
  const fallbackPortPointsByConnection = new Map<string, IndexedPortPoint[]>()
  const consumedPointIndexes = new Set<number>()
  const pairs: NodePortPointPair[] = []

  for (const indexedPortPoint of indexedPortPoints) {
    const { portPoint } = indexedPortPoint

    if (portPoint.portPointId) {
      if (indexedPortPointById.has(portPoint.portPointId)) {
        indexedPortPointById.set(portPoint.portPointId, null)
      } else {
        indexedPortPointById.set(portPoint.portPointId, indexedPortPoint)
      }
    }

    const existing = fallbackPortPointsByConnection.get(
      portPoint.connectionName,
    )
    if (existing) {
      existing.push(indexedPortPoint)
    } else {
      fallbackPortPointsByConnection.set(portPoint.connectionName, [
        indexedPortPoint,
      ])
    }
  }

  for (const [startPortPointId, endPortPointId] of getExplicitPortPointPairIds(
    nodeWithPortPoints,
  ) ?? []) {
    const start = indexedPortPointById.get(startPortPointId)
    const end = indexedPortPointById.get(endPortPointId)
    if (!start || !end) continue
    if (start.index === end.index) continue
    if (start.portPoint.connectionName !== end.portPoint.connectionName) {
      continue
    }

    consumedPointIndexes.add(start.index)
    consumedPointIndexes.add(end.index)
    pairs.push({
      pairKey: getPortPointPairKey(
        start.portPoint.connectionName,
        start.portPoint,
        end.portPoint,
      ),
      connectionName: start.portPoint.connectionName,
      rootConnectionName:
        start.portPoint.rootConnectionName ?? end.portPoint.rootConnectionName,
      start: start.portPoint,
      end: end.portPoint,
    })
  }

  for (const indexedPoints of fallbackPortPointsByConnection.values()) {
    const unpairedPoints = indexedPoints.filter(
      ({ index }) => !consumedPointIndexes.has(index),
    )

    for (let index = 0; index < unpairedPoints.length - 1; index += 1) {
      const start = unpairedPoints[index]!.portPoint
      const end = unpairedPoints[index + 1]!.portPoint
      pairs.push({
        pairKey: getPortPointPairKey(start.connectionName, start, end),
        connectionName: start.connectionName,
        rootConnectionName: start.rootConnectionName ?? end.rootConnectionName,
        start,
        end,
      })
    }
  }

  return pairs
}
