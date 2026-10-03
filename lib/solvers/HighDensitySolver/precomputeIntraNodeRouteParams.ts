import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getMinDistBetweenEnteringPoints } from "lib/utils/getMinDistBetweenEnteringPoints"

export type IntraNodeConnectionPoint = { x: number; y: number; z: number }

export type PrecomputedIntraNodeRouteParams = {
  connectionPointsByName: ReadonlyMap<string, readonly IntraNodeConnectionPoint[]>
  rootConnectionNameByConnectionName: ReadonlyMap<string, string>
  minDistBetweenEnteringPoints: number
}

/** Fixed node topology is shared by the candidates in one portfolio attempt. */
export const precomputeIntraNodeRouteParams = (
  node: NodeWithPortPoints,
): PrecomputedIntraNodeRouteParams => {
  const connectionPointsByName = new Map<string, IntraNodeConnectionPoint[]>()
  const rootConnectionNameByConnectionName = new Map<string, string>()
  const seenPointsByConnectionName = new Map<string, Set<string>>()
  for (const { connectionName, rootConnectionName, x, y, z } of node.portPoints) {
    if (rootConnectionName) {
      rootConnectionNameByConnectionName.set(connectionName, rootConnectionName)
    }
    let points = connectionPointsByName.get(connectionName)
    let seenPoints = seenPointsByConnectionName.get(connectionName)
    if (!points || !seenPoints) {
      points = []
      seenPoints = new Set()
      connectionPointsByName.set(connectionName, points)
      seenPointsByConnectionName.set(connectionName, seenPoints)
    }
    const layer = z ?? 0
    const key = `${x.toFixed(6)},${y.toFixed(6)},${layer}`
    if (seenPoints.has(key)) continue
    seenPoints.add(key)
    points.push({ x, y, z: layer })
  }
  return {
    connectionPointsByName,
    rootConnectionNameByConnectionName,
    minDistBetweenEnteringPoints: getMinDistBetweenEnteringPoints(node),
  }
}
