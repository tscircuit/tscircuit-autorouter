/*
 * Owned experimental kernel adapted from @tscircuit/high-density-a01 0.0.36
 * (10cdce5ad). Native occupancy/rip rules remain frozen within each query.
 *
 * MIT License
 *
 * Copyright (c) 2026 tscircuit
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { PortPoint } from "@tscircuit/high-density-a01"

type PortPointPair = [PortPoint, PortPoint]

const getPairKey = (a: PortPoint, b: PortPoint) => {
  const aKey = a.portPointId ?? `${a.connectionName}:${a.x}:${a.y}:${a.z}`
  const bKey = b.portPointId ?? `${b.connectionName}:${b.x}:${b.y}:${b.z}`
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
}

const createPortPointsByIdMap = (
  portPoints: PortPoint[],
): Map<string, PortPoint> => {
  const portPointsById = new Map<string, PortPoint>()

  for (const portPoint of portPoints) {
    if (!portPoint.portPointId) continue
    portPointsById.set(portPoint.portPointId, portPoint)
  }

  return portPointsById
}

const appendPairIfUnique = (
  pair: PortPointPair,
  seenPairKeys: Set<string>,
  pairs: PortPointPair[],
) => {
  const [startPortPoint, endPortPoint] = pair
  if (startPortPoint === endPortPoint) return

  const pairKey = getPairKey(startPortPoint, endPortPoint)
  if (seenPairKeys.has(pairKey)) return

  seenPairKeys.add(pairKey)
  pairs.push(pair)
}

const appendAdjacentPairs = (
  portPoints: PortPoint[],
  seenPairKeys: Set<string>,
  pairs: PortPointPair[],
) => {
  for (let i = 0; i < portPoints.length - 1; i++) {
    appendPairIfUnique(
      [portPoints[i]!, portPoints[i + 1]!],
      seenPairKeys,
      pairs,
    )
  }
}

const getLinkedPortPointIdSet = (pairs: PortPointPair[]) => {
  const linkedPortPointIds = new Set<string>()

  for (const [startPortPoint, endPortPoint] of pairs) {
    if (startPortPoint.portPointId) {
      linkedPortPointIds.add(startPortPoint.portPointId)
    }
    if (endPortPoint.portPointId) {
      linkedPortPointIds.add(endPortPoint.portPointId)
    }
  }

  return linkedPortPointIds
}

/**
 * Builds the routeable point-to-point segments for a single connection.
 *
 * @param portPoints - Port points that belong to one connection, in their source order.
 * @returns A de-duplicated list of port-point pairs that should be routed.
 *
 * @remarks
 * Linked chains using `prevPortPointId` and `nextPortPointId` are preferred when present.
 * If no links are present, or some points are unlinked, the function falls back to adjacent
 * source order so older fixtures keep working.
 *
 * @caution
 * This function assumes every item in `portPoints` already belongs to the same connection.
 */
export const getConnectionPortPointPairs = (
  portPoints: PortPoint[],
): PortPointPair[] => {
  const pairs: PortPointPair[] = []
  const seenPairKeys = new Set<string>()
  const portPointsById = createPortPointsByIdMap(portPoints)

  for (const portPoint of portPoints) {
    if (portPoint.prevPortPointId) {
      const prev = portPointsById.get(portPoint.prevPortPointId)
      if (prev && prev.connectionName === portPoint.connectionName) {
        appendPairIfUnique([prev, portPoint], seenPairKeys, pairs)
      }
    }
    if (portPoint.nextPortPointId) {
      const next = portPointsById.get(portPoint.nextPortPointId)
      if (next && next.connectionName === portPoint.connectionName) {
        appendPairIfUnique([portPoint, next], seenPairKeys, pairs)
      }
    }
  }

  if (pairs.length === 0) {
    appendAdjacentPairs(portPoints, seenPairKeys, pairs)
    return pairs
  }

  const linkedIds = getLinkedPortPointIdSet(pairs)
  const unlinkedPortPoints = portPoints.filter(
    (portPoint) =>
      !portPoint.portPointId || !linkedIds.has(portPoint.portPointId),
  )
  appendAdjacentPairs(unlinkedPortPoints, seenPairKeys, pairs)

  return pairs
}
