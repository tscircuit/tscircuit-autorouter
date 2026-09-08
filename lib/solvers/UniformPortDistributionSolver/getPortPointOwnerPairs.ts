import type { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import { normalizeOwnerPair } from "./getOwnerPairKey"
import type { OwnerPair } from "./types"

/** Index the first declared ownership, preserving input node and point order. */
export const getPortPointOwnerPairs = (
  inputNodes: InputNodeWithPortPoints[],
): Map<string, OwnerPair | undefined> => {
  const owners = new Map<string, OwnerPair | undefined>()
  for (const node of inputNodes) {
    const seenPortPointIds = new Set<string>()
    for (const point of node.portPoints) {
      const id = point.portPointId
      if (!id || seenPortPointIds.has(id)) continue
      seenPortPointIds.add(id)
      if (owners.has(id) || !point.connectionNodeIds) continue
      const pair = point.connectionNodeIds
      owners.set(
        id,
        pair.length === 2 && pair[0] && pair[1]
          ? normalizeOwnerPair(pair[0], pair[1])
          : undefined,
      )
    }
  }
  return owners
}
