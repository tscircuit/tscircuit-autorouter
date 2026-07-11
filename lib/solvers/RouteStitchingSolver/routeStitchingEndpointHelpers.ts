import { distance, type Point3 } from "@tscircuit/math-utils"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import {
  comparePoints,
  compareRoutes,
  DISTANCE_TIE_TOLERANCE,
  MAX_STITCH_GAP_DISTANCE_3,
  MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
  STITCH_GEOMETRIC_TOLERANCE,
} from "./routeStitchingShared"

/**
 * Endpoints within this tolerance are treated as the same island endpoint.
 */
export const ENDPOINT_MATCH_TOLERANCE = 0.1

type OrientedRouteFragment = {
  key: string
  routeIndex: number
  start: Point3
  end: Point3
  routePolylineLength: number
}

type OrientedRouteSearchNode = {
  key: string
  directionIndex: number
  terminalEnd: Point3
  fragment: OrientedRouteFragment
}

type StitchPathCost = {
  nonCoincidentGapCount: number
  totalGapDistance: number
  insertedLayerTransitionCount: number
  routeCount: number
  routePolylineLength: number
}

type StitchPathQueueEntry = {
  nodeKey: string
  cost: StitchPathCost
  queueOrder: number
  /** Immutable path snapshot; later cost improvements cannot rewrite it. */
  routeIndexes: readonly number[]
}

export type CanStitchBetweenTerminals = (params: {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: Point3
  end: Point3
}) => boolean

/**
 * Maintains a deterministic cluster map for route endpoints so different route
 * fragments that terminate at effectively the same location share one key.
 */
export class EndpointClusterIndex {
  private endpointClusters = new Map<
    string,
    Array<{ key: string; point: Point3 }>
  >()

  getEndpointKey(connectionName: string, point: Point3) {
    const clusters = this.endpointClusters.get(connectionName) ?? []

    let bestCluster: { key: string; point: Point3 } | undefined
    let bestDistance = Infinity

    for (const cluster of clusters) {
      if (cluster.point.z !== point.z) continue
      const clusterDistance = distance(cluster.point, point)
      if (
        clusterDistance <= ENDPOINT_MATCH_TOLERANCE &&
        (clusterDistance < bestDistance - DISTANCE_TIE_TOLERANCE ||
          (Math.abs(clusterDistance - bestDistance) <= DISTANCE_TIE_TOLERANCE &&
            (!bestCluster ||
              comparePoints(cluster.point, bestCluster.point) < 0)))
      ) {
        bestCluster = cluster
        bestDistance = clusterDistance
      }
    }

    if (bestCluster) {
      return bestCluster.key
    }

    const key = `${connectionName}:endpoint_${clusters.length}`
    clusters.push({
      key,
      point: { x: point.x, y: point.y, z: point.z },
    })
    this.endpointClusters.set(connectionName, clusters)
    return key
  }

  getClusters(connectionName: string) {
    return this.endpointClusters.get(connectionName) ?? []
  }

  getClosestEndpointKey(
    connectionName: string,
    routes: HighDensityIntraNodeRoute[],
    point: Point3,
  ) {
    let bestHash: string | null = null
    let bestEndpoint: Point3 | null = null
    let bestDist = Infinity

    for (const route of routes) {
      const endpoints = [route.route[0]!, route.route[route.route.length - 1]!]
      for (const endpoint of endpoints) {
        const dist = distance(point, endpoint)
        const endpointHash = this.getEndpointKey(connectionName, endpoint)
        if (
          dist < bestDist - DISTANCE_TIE_TOLERANCE ||
          (Math.abs(dist - bestDist) <= DISTANCE_TIE_TOLERANCE &&
            (bestHash === null ||
              endpointHash.localeCompare(bestHash) < 0 ||
              (endpointHash === bestHash &&
                bestEndpoint !== null &&
                comparePoints(endpoint, bestEndpoint) < 0)))
        ) {
          bestDist = dist
          bestHash = endpointHash
          bestEndpoint = endpoint
        }
      }
    }

    return bestHash
  }
}

const EMPTY_STITCH_PATH_COST: StitchPathCost = {
  nonCoincidentGapCount: 0,
  totalGapDistance: 0,
  insertedLayerTransitionCount: 0,
  routeCount: 0,
  routePolylineLength: 0,
}

const compareStitchPathCosts = (
  left: StitchPathCost,
  right: StitchPathCost,
): number => {
  if (left.nonCoincidentGapCount !== right.nonCoincidentGapCount) {
    return left.nonCoincidentGapCount - right.nonCoincidentGapCount
  }
  if (
    Math.abs(left.totalGapDistance - right.totalGapDistance) >
    DISTANCE_TIE_TOLERANCE
  ) {
    return left.totalGapDistance - right.totalGapDistance
  }
  if (
    left.insertedLayerTransitionCount !== right.insertedLayerTransitionCount
  ) {
    return (
      left.insertedLayerTransitionCount - right.insertedLayerTransitionCount
    )
  }
  if (left.routeCount !== right.routeCount) {
    return left.routeCount - right.routeCount
  }
  if (
    Math.abs(left.routePolylineLength - right.routePolylineLength) >
    DISTANCE_TIE_TOLERANCE
  ) {
    return left.routePolylineLength - right.routePolylineLength
  }
  return 0
}

const addStitchPathCosts = (
  left: StitchPathCost,
  right: StitchPathCost,
): StitchPathCost => {
  return {
    nonCoincidentGapCount:
      left.nonCoincidentGapCount + right.nonCoincidentGapCount,
    totalGapDistance: left.totalGapDistance + right.totalGapDistance,
    insertedLayerTransitionCount:
      left.insertedLayerTransitionCount + right.insertedLayerTransitionCount,
    routeCount: left.routeCount + right.routeCount,
    routePolylineLength: left.routePolylineLength + right.routePolylineLength,
  }
}

const getConnectorCost = (params: {
  from: Point3
  to: Point3
  maxGapDistance: number
  allowNonCoincidentLayerTransition: boolean
  allowedLayerTransitionPointKeys?: ReadonlySet<string>
}): StitchPathCost | null => {
  const gapDistance = distance(params.from, params.to)
  if (gapDistance > params.maxGapDistance + DISTANCE_TIE_TOLERANCE) {
    return null
  }

  const changesLayer = params.from.z !== params.to.z
  if (
    changesLayer &&
    !params.allowNonCoincidentLayerTransition &&
    gapDistance >= STITCH_GEOMETRIC_TOLERANCE
  ) {
    return null
  }
  if (
    changesLayer &&
    params.allowedLayerTransitionPointKeys &&
    !params.allowedLayerTransitionPointKeys.has(getXyPointKey(params.to))
  ) {
    return null
  }

  const isNonCoincidentGap = gapDistance >= STITCH_GEOMETRIC_TOLERANCE
  return {
    ...EMPTY_STITCH_PATH_COST,
    nonCoincidentGapCount: isNonCoincidentGap ? 1 : 0,
    totalGapDistance: isNonCoincidentGap ? gapDistance : 0,
    insertedLayerTransitionCount: changesLayer ? 1 : 0,
  }
}

const getOrientedRouteFragments = (
  routes: HighDensityIntraNodeRoute[],
  connectionName: string,
): OrientedRouteFragment[] => {
  return routes.flatMap(
    (
      route: HighDensityIntraNodeRoute,
      routeIndex: number,
    ): OrientedRouteFragment[] => {
      const start = route.route[0]
      const end = route.route[route.route.length - 1]
      if (!start || !end) {
        throw new Error(
          `Cannot select stitch path for connection "${connectionName}": fragment ${route.regionId ?? routeIndex} is empty`,
        )
      }
      let routePolylineLength = 0
      for (
        let pointIndex = 0;
        pointIndex < route.route.length - 1;
        pointIndex++
      ) {
        routePolylineLength += distance(
          route.route[pointIndex]!,
          route.route[pointIndex + 1]!,
        )
      }
      return [
        {
          key: `${routeIndex}:forward`,
          routeIndex,
          start,
          end,
          routePolylineLength,
        },
        {
          key: `${routeIndex}:reverse`,
          routeIndex,
          start: end,
          end: start,
          routePolylineLength,
        },
      ]
    },
  )
}

const queueStitchPathCandidate = (params: {
  nodeKey: string
  cost: StitchPathCost
  routeIndexes: readonly number[]
  bestCostByNodeKey: Map<string, StitchPathCost>
  bestEntryByNodeKey: Map<string, StitchPathQueueEntry>
  queue: StitchPathQueueEntry[]
  queueOrder: number
}): boolean => {
  const existingCost = params.bestCostByNodeKey.get(params.nodeKey)
  if (existingCost && compareStitchPathCosts(params.cost, existingCost) >= 0) {
    return false
  }

  params.bestCostByNodeKey.set(params.nodeKey, params.cost)
  const entry: StitchPathQueueEntry = {
    nodeKey: params.nodeKey,
    cost: params.cost,
    queueOrder: params.queueOrder,
    routeIndexes: params.routeIndexes,
  }
  params.bestEntryByNodeKey.set(params.nodeKey, entry)
  params.queue.push(entry)
  return true
}

/**
 * Chooses the island endpoints that best align to the requested connection
 * terminals, with deterministic tie-breaking.
 */
export const selectIslandEndpoints = (params: {
  possibleEndpoints: Point3[]
  globalStart: Point3
  globalEnd: Point3
}) => {
  const sortedEndpoints = [...params.possibleEndpoints].sort(comparePoints)
  const start = sortedEndpoints.reduce((bestPoint, point) => {
    const pointDistance = distance(point, params.globalStart)
    const bestDistance = distance(bestPoint, params.globalStart)
    return pointDistance < bestDistance - DISTANCE_TIE_TOLERANCE ||
      (Math.abs(pointDistance - bestDistance) <= DISTANCE_TIE_TOLERANCE &&
        comparePoints(point, bestPoint) < 0)
      ? point
      : bestPoint
  })

  const remainingEndpoints = sortedEndpoints.filter((point) => point !== start)

  const endCandidates =
    remainingEndpoints.length > 0
      ? remainingEndpoints
      : params.possibleEndpoints

  const end = endCandidates.reduce((bestPoint, point) => {
    const pointDistance = distance(point, params.globalEnd)
    const bestDistance = distance(bestPoint, params.globalEnd)
    return pointDistance < bestDistance - DISTANCE_TIE_TOLERANCE ||
      (Math.abs(pointDistance - bestDistance) <= DISTANCE_TIE_TOLERANCE &&
        comparePoints(point, bestPoint) < 0)
      ? point
      : bestPoint
  })

  return { start, end }
}

/**
 * Pulls an island endpoint onto an actual terminal only when the endpoint is
 * already close enough to be considered the same stitch target.
 */
export const snapIslandEndpointToNearestTerminal = (params: {
  islandEndpoint: Point3
  terminals: Point3[]
  maxSnapDistance: number
}) => {
  const sortedTerminals = [...params.terminals].sort(comparePoints)
  let closestTerminal = sortedTerminals[0]
  let closestDistance = distance(params.islandEndpoint, closestTerminal)

  for (const terminal of sortedTerminals.slice(1)) {
    const terminalDistance = distance(params.islandEndpoint, terminal)
    const terminalMatchesLayer = terminal.z === params.islandEndpoint.z
    const closestMatchesLayer = closestTerminal.z === params.islandEndpoint.z
    if (
      terminalDistance < closestDistance - DISTANCE_TIE_TOLERANCE ||
      (Math.abs(terminalDistance - closestDistance) <= DISTANCE_TIE_TOLERANCE &&
        ((terminalMatchesLayer && !closestMatchesLayer) ||
          (terminalMatchesLayer === closestMatchesLayer &&
            comparePoints(terminal, closestTerminal) < 0)))
    ) {
      closestTerminal = terminal
      closestDistance = terminalDistance
    }
  }

  return closestDistance <= params.maxSnapDistance
    ? closestTerminal
    : params.islandEndpoint
}

/**
 * Finds a deterministic terminal-to-terminal path through oriented route
 * fragments. Every graph hop consumes a fragment, so nearby unused endpoints
 * cannot form a synthetic shortcut through fragments that were never selected.
 */
export const selectRoutesAlongEndpointPath = (params: {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: Point3
  end: Point3
  canStitchBetweenTerminals: CanStitchBetweenTerminals
  allowedLayerTransitionPointKeys?: ReadonlySet<string>
}): HighDensityIntraNodeRoute[] => {
  if (params.hdRoutes.length === 0) {
    throw new Error(
      `Cannot select stitch path for connection "${params.connectionName}": no route fragments were provided`,
    )
  }
  const canonicalHdRoutes = [...params.hdRoutes].sort(compareRoutes)
  const orientedFragments = getOrientedRouteFragments(
    canonicalHdRoutes,
    params.connectionName,
  )
  const terminalDirections = [
    { start: params.start, end: params.end },
    { start: params.end, end: params.start },
  ]
  const searchNodes: OrientedRouteSearchNode[] = terminalDirections.flatMap(
    (terminalDirection, directionIndex): OrientedRouteSearchNode[] =>
      orientedFragments.map(
        (fragment): OrientedRouteSearchNode => ({
          key: `${directionIndex}|${fragment.key}`,
          directionIndex,
          terminalEnd: terminalDirection.end,
          fragment,
        }),
      ),
  )
  const searchNodeByKey = new Map<string, OrientedRouteSearchNode>(
    searchNodes.map((searchNode) => [searchNode.key, searchNode]),
  )
  const bestCostByNodeKey = new Map<string, StitchPathCost>()
  const bestEntryByNodeKey = new Map<string, StitchPathQueueEntry>()
  const queue: StitchPathQueueEntry[] = []
  const sinkNodeKey = "terminal-sink"
  let nextQueueOrder = 0

  for (const searchNode of searchNodes) {
    const fragment = searchNode.fragment
    const connectorCost = getConnectorCost({
      from: terminalDirections[searchNode.directionIndex]!.start,
      to: fragment.start,
      maxGapDistance: MAX_STITCH_GAP_DISTANCE_3,
      allowNonCoincidentLayerTransition: false,
      allowedLayerTransitionPointKeys: params.allowedLayerTransitionPointKeys,
    })
    if (!connectorCost) continue

    const initialCost = addStitchPathCosts(connectorCost, {
      ...EMPTY_STITCH_PATH_COST,
      routeCount: 1,
      routePolylineLength: fragment.routePolylineLength,
    })
    if (
      queueStitchPathCandidate({
        nodeKey: searchNode.key,
        cost: initialCost,
        routeIndexes: [fragment.routeIndex],
        bestCostByNodeKey,
        bestEntryByNodeKey,
        queue,
        queueOrder: nextQueueOrder,
      })
    ) {
      nextQueueOrder++
    }
  }

  while (queue.length > 0) {
    queue.sort(
      (left, right) =>
        compareStitchPathCosts(left.cost, right.cost) ||
        left.queueOrder - right.queueOrder,
    )
    const current = queue.shift()!
    const currentBestCost = bestCostByNodeKey.get(current.nodeKey)
    if (
      !currentBestCost ||
      compareStitchPathCosts(current.cost, currentBestCost) !== 0
    ) {
      continue
    }
    if (current.nodeKey === sinkNodeKey) break

    const currentSearchNode = searchNodeByKey.get(current.nodeKey)
    if (!currentSearchNode) {
      throw new Error(
        `Cannot select stitch path for connection "${params.connectionName}": missing oriented fragment ${current.nodeKey}`,
      )
    }
    const currentFragment = currentSearchNode.fragment

    const terminalConnectorCost = getConnectorCost({
      from: currentFragment.end,
      to: currentSearchNode.terminalEnd,
      maxGapDistance: MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
      allowNonCoincidentLayerTransition: true,
      allowedLayerTransitionPointKeys: params.allowedLayerTransitionPointKeys,
    })
    if (terminalConnectorCost) {
      const terminalCost = addStitchPathCosts(
        current.cost,
        terminalConnectorCost,
      )
      if (
        queueStitchPathCandidate({
          nodeKey: sinkNodeKey,
          cost: terminalCost,
          routeIndexes: current.routeIndexes,
          bestCostByNodeKey,
          bestEntryByNodeKey,
          queue,
          queueOrder: nextQueueOrder,
        })
      ) {
        nextQueueOrder++
      }
    }

    for (const nextSearchNode of searchNodes) {
      if (nextSearchNode.directionIndex !== currentSearchNode.directionIndex) {
        continue
      }
      const nextFragment = nextSearchNode.fragment
      if (current.routeIndexes.includes(nextFragment.routeIndex)) continue
      const connectorCost = getConnectorCost({
        from: currentFragment.end,
        to: nextFragment.start,
        maxGapDistance: MAX_STITCH_GAP_DISTANCE_3,
        allowNonCoincidentLayerTransition: false,
        allowedLayerTransitionPointKeys: params.allowedLayerTransitionPointKeys,
      })
      if (!connectorCost) continue

      const nextCost = addStitchPathCosts(
        addStitchPathCosts(current.cost, connectorCost),
        {
          ...EMPTY_STITCH_PATH_COST,
          routeCount: 1,
          routePolylineLength: nextFragment.routePolylineLength,
        },
      )
      if (
        queueStitchPathCandidate({
          nodeKey: nextSearchNode.key,
          cost: nextCost,
          routeIndexes: [...current.routeIndexes, nextFragment.routeIndex],
          bestCostByNodeKey,
          bestEntryByNodeKey,
          queue,
          queueOrder: nextQueueOrder,
        })
      ) {
        nextQueueOrder++
      }
    }
  }

  const sinkEntry = bestEntryByNodeKey.get(sinkNodeKey)
  if (!sinkEntry) {
    throw new Error(
      `Cannot select stitch path for connection "${params.connectionName}": no terminal-to-terminal fragment path exists within stitch limits`,
    )
  }

  const selectedRouteIndexes = sinkEntry.routeIndexes
  if (new Set(selectedRouteIndexes).size !== selectedRouteIndexes.length) {
    throw new Error(
      `Cannot select stitch path for connection "${params.connectionName}": minimum-cost path repeats a route fragment`,
    )
  }
  const selectedHdRoutes = selectedRouteIndexes.map(
    (routeIndex) => canonicalHdRoutes[routeIndex]!,
  )
  if (
    selectedHdRoutes.length === 0 ||
    !params.canStitchBetweenTerminals({
      connectionName: params.connectionName,
      hdRoutes: selectedHdRoutes,
      start: params.start,
      end: params.end,
    })
  ) {
    const selectedRegionIds = selectedHdRoutes
      .map((route) => route.regionId ?? "unknown-region")
      .join(", ")
    throw new Error(
      `Cannot select stitch path for connection "${params.connectionName}": minimum-cost fragment path failed stitch validation (${selectedRegionIds})`,
    )
  }

  return selectedHdRoutes
}

export const hasStitchableGapBetweenUnsolvedRoutes = (
  unsolvedRoutes: Array<{ start: Point3; end: Point3 }>,
) => {
  for (let i = 0; i < unsolvedRoutes.length; i++) {
    for (let j = i + 1; j < unsolvedRoutes.length; j++) {
      const endpointsA = [unsolvedRoutes[i]!.start, unsolvedRoutes[i]!.end]
      const endpointsB = [unsolvedRoutes[j]!.start, unsolvedRoutes[j]!.end]

      for (const endpointA of endpointsA) {
        for (const endpointB of endpointsB) {
          if (endpointA.z !== endpointB.z) continue
          if (distance(endpointA, endpointB) <= MAX_STITCH_GAP_DISTANCE_3) {
            return true
          }
        }
      }
    }
  }

  return false
}
