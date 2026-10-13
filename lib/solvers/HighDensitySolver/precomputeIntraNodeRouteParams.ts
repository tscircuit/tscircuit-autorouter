import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"
import { getMinDistBetweenEnteringPoints } from "lib/utils/getMinDistBetweenEnteringPoints"

export type IntraNodeConnectionPoint = { x: number; y: number; z: number }

export type IntraNodeConnectionTask = {
  connectionName: string
  rootConnectionName?: string
  points: IntraNodeConnectionPoint[]
}

export type PrecomputedIntraNodeRouteParams = {
  connectionPointsByName: ReadonlyMap<
    string,
    readonly IntraNodeConnectionPoint[]
  >
  rootConnectionNameByConnectionName: ReadonlyMap<string, string>
  explicitConnectionPairs?: readonly IntraNodeConnectionTask[]
  hasMultipleExplicitConnectionPairs?: boolean
  hasMatchingLinkedConnectionPairs?: boolean
  minDistBetweenEnteringPoints: number
}

const getRegionalPointKey = (point: PortPoint): string => {
  return JSON.stringify([
    point.connectionName,
    point.portPointId,
    point.x,
    point.y,
    point.z,
  ])
}

const getExplicitConnectionPairs = (
  node: NodeWithPortPoints,
): IntraNodeConnectionTask[] | undefined => {
  if (node.useExplicitPortPointPairs !== true) return undefined
  if (!node.portPointsInPairs?.length) {
    if (node.portPoints.length > 0) {
      throw new Error("Authoritative regional port pairs are required")
    }
    return []
  }
  const nodePointKeys = new Set(node.portPoints.map(getRegionalPointKey))
  const pairedPointKeys = new Set<string>()
  const seenPairKeys = new Set<string>()
  const rootConnectionNames = new Map<string, string>()
  const pairs: IntraNodeConnectionTask[] = []
  for (const [start, end] of node.portPointsInPairs) {
    if (start.connectionName !== end.connectionName) {
      throw new Error(
        `Regional port pair has different connection names: "${start.connectionName}" and "${end.connectionName}"`,
      )
    }
    const rootConnectionName =
      start.rootConnectionName ?? end.rootConnectionName
    const previousRoot = rootConnectionNames.get(start.connectionName)
    if (
      previousRoot &&
      rootConnectionName &&
      previousRoot !== rootConnectionName
    ) {
      throw new Error(
        `Regional pairs for "${start.connectionName}" have conflicting root connection names`,
      )
    }
    if (rootConnectionName) {
      rootConnectionNames.set(start.connectionName, rootConnectionName)
    }
    if (
      start.rootConnectionName &&
      end.rootConnectionName &&
      start.rootConnectionName !== end.rootConnectionName
    ) {
      throw new Error(
        `Regional port pair "${start.connectionName}" has conflicting root connection names`,
      )
    }
    const pointKeys = [start, end].map(getRegionalPointKey)
    for (const key of pointKeys) {
      if (!nodePointKeys.has(key)) {
        throw new Error(
          "Regional port pair contains a point absent from its node",
        )
      }
      pairedPointKeys.add(key)
    }
    const pairKey = JSON.stringify([
      start.connectionName,
      [start, end]
        .map((point): string => JSON.stringify([point.x, point.y, point.z]))
        .sort(),
    ])
    if (seenPairKeys.has(pairKey)) continue
    seenPairKeys.add(pairKey)
    pairs.push({
      connectionName: start.connectionName,
      rootConnectionName,
      points: [
        { x: start.x, y: start.y, z: start.z },
        { x: end.x, y: end.y, z: end.z },
      ],
    })
  }
  if (
    node.portPoints.some(
      (point): boolean => !pairedPointKeys.has(getRegionalPointKey(point)),
    )
  ) {
    throw new Error("Explicit regional port pairs leave node points unpaired")
  }
  return pairs
}

const hasMultipleConnectionPairs = (
  pairs: readonly IntraNodeConnectionTask[] | undefined,
): boolean => {
  if (!pairs) return false
  const connectionNames = new Set<string>()
  for (const pair of pairs) {
    if (connectionNames.has(pair.connectionName)) return true
    connectionNames.add(pair.connectionName)
  }
  return false
}

const getConnectionPairKey = (
  connectionName: string,
  rootConnectionName: string | undefined,
  points: readonly IntraNodeConnectionPoint[],
): string => {
  return JSON.stringify([
    connectionName,
    rootConnectionName,
    points
      .map((point): string => JSON.stringify([point.x, point.y, point.z]))
      .sort(),
  ])
}

const hasMatchingLinkedConnectionPairs = (
  node: NodeWithPortPoints,
  explicitPairs: readonly IntraNodeConnectionTask[] | undefined,
): boolean => {
  if (!explicitPairs) return true
  const portPointsByConnectionName = new Map<string, PortPoint[]>()
  for (const point of node.portPoints) {
    const points = portPointsByConnectionName.get(point.connectionName)
    if (points) points.push(point)
    else portPointsByConnectionName.set(point.connectionName, [point])
  }
  const linkedPairKeys = new Set<string>()
  for (const points of portPointsByConnectionName.values()) {
    for (const [start, end] of getConnectionPortPointPairs(points)) {
      linkedPairKeys.add(
        getConnectionPairKey(
          start.connectionName,
          start.rootConnectionName ?? end.rootConnectionName,
          [start, end],
        ),
      )
    }
  }
  return (
    linkedPairKeys.size === explicitPairs.length &&
    explicitPairs.every((pair): boolean =>
      linkedPairKeys.has(
        getConnectionPairKey(
          pair.connectionName,
          pair.rootConnectionName,
          pair.points,
        ),
      ),
    )
  )
}

/** Fixed node topology is shared by the candidates in one portfolio attempt. */
export const precomputeIntraNodeRouteParams = (
  node: NodeWithPortPoints,
): PrecomputedIntraNodeRouteParams => {
  const connectionPointsByName = new Map<string, IntraNodeConnectionPoint[]>()
  const rootConnectionNameByConnectionName = new Map<string, string>()
  const seenPointsByConnectionName = new Map<string, Set<string>>()
  for (const {
    connectionName,
    rootConnectionName,
    x,
    y,
    z,
  } of node.portPoints) {
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
  const explicitConnectionPairs = getExplicitConnectionPairs(node)
  return {
    connectionPointsByName,
    rootConnectionNameByConnectionName,
    ...(node.useExplicitPortPointPairs === true
      ? {
          explicitConnectionPairs,
          hasMultipleExplicitConnectionPairs: hasMultipleConnectionPairs(
            explicitConnectionPairs,
          ),
          hasMatchingLinkedConnectionPairs: hasMatchingLinkedConnectionPairs(
            node,
            explicitConnectionPairs,
          ),
        }
      : {}),
    minDistBetweenEnteringPoints: getMinDistBetweenEnteringPoints(node),
  }
}
