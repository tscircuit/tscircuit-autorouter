import { distance, type Point3 } from "@tscircuit/math-utils"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import {
  comparePoints,
  compareRoutes,
  DISTANCE_TIE_TOLERANCE,
  MAX_STITCH_GAP_DISTANCE_3,
  MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
} from "./routeStitchingShared"

/**
 * Endpoints within this tolerance are treated as the same island endpoint.
 */
export const ENDPOINT_MATCH_TOLERANCE = 0.1

type EndpointEdge = {
  nextHash: string
  routeIndex: number | null
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

const addAdjacencyEdge = (
  adjacency: Map<string, EndpointEdge[]>,
  fromHash: string,
  edge: EndpointEdge,
) => {
  const entries = adjacency.get(fromHash) ?? []
  if (
    entries.some(
      (existingEdge) =>
        existingEdge.nextHash === edge.nextHash &&
        existingEdge.routeIndex === edge.routeIndex,
    )
  ) {
    return
  }
  entries.push(edge)
  adjacency.set(fromHash, entries)
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
}) => {
  let closestTerminal = [...params.terminals].sort(comparePoints)[0]
  let closestDistance = distance(params.islandEndpoint, closestTerminal)

  for (const terminal of params.terminals.slice(1)) {
    const terminalDistance = distance(params.islandEndpoint, terminal)
    if (
      terminalDistance < closestDistance - DISTANCE_TIE_TOLERANCE ||
      (Math.abs(terminalDistance - closestDistance) <= DISTANCE_TIE_TOLERANCE &&
        comparePoints(terminal, closestTerminal) < 0)
    ) {
      closestTerminal = terminal
      closestDistance = terminalDistance
    }
  }

  return closestDistance <= MAX_TERMINAL_STITCH_GAP_DISTANCE_3
    ? closestTerminal
    : params.islandEndpoint
}

/**
 * Returns the route islands on the deterministic endpoint path between the
 * chosen terminals. If the subset cannot actually stitch to both terminals,
 * the full route set is returned instead.
 */
export const selectRoutesAlongEndpointPath = (params: {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: Point3
  end: Point3
  endpointIndex: EndpointClusterIndex
  canStitchBetweenTerminals: CanStitchBetweenTerminals
}) => {
  if (params.hdRoutes.length <= 2) return params.hdRoutes

  const canonicalHdRoutes = [...params.hdRoutes].sort(compareRoutes)

  const startHash = params.endpointIndex.getClosestEndpointKey(
    params.connectionName,
    canonicalHdRoutes,
    params.start,
  )
  const endHash = params.endpointIndex.getClosestEndpointKey(
    params.connectionName,
    canonicalHdRoutes,
    params.end,
  )

  if (!startHash || !endHash || startHash === endHash) {
    return canonicalHdRoutes
  }

  const adjacency = new Map<string, EndpointEdge[]>()

  for (let i = 0; i < canonicalHdRoutes.length; i++) {
    const route = canonicalHdRoutes[i]!
    const routeStartHash = params.endpointIndex.getEndpointKey(
      params.connectionName,
      route.route[0]!,
    )
    const routeEndHash = params.endpointIndex.getEndpointKey(
      params.connectionName,
      route.route[route.route.length - 1]!,
    )

    addAdjacencyEdge(adjacency, routeStartHash, {
      nextHash: routeEndHash,
      routeIndex: i,
    })
    addAdjacencyEdge(adjacency, routeEndHash, {
      nextHash: routeStartHash,
      routeIndex: i,
    })
  }

  const sortedEndpointClusters = [
    ...params.endpointIndex.getClusters(params.connectionName),
  ].sort((a, b) => comparePoints(a.point, b.point))
  for (let i = 0; i < sortedEndpointClusters.length; i++) {
    const endpointA = sortedEndpointClusters[i]!
    for (let j = i + 1; j < sortedEndpointClusters.length; j++) {
      const endpointB = sortedEndpointClusters[j]!
      if (endpointA.point.z !== endpointB.point.z) continue
      if (
        distance(endpointA.point, endpointB.point) > MAX_STITCH_GAP_DISTANCE_3
      )
        continue

      addAdjacencyEdge(adjacency, endpointA.key, {
        nextHash: endpointB.key,
        routeIndex: null,
      })
      addAdjacencyEdge(adjacency, endpointB.key, {
        nextHash: endpointA.key,
        routeIndex: null,
      })
    }
  }

  for (const [hash, edges] of adjacency.entries()) {
    adjacency.set(
      hash,
      [...edges].sort((a, b) => {
        if (a.routeIndex === null && b.routeIndex !== null) return 1
        if (a.routeIndex !== null && b.routeIndex === null) return -1
        if (a.routeIndex !== null && b.routeIndex !== null) {
          const routeCmp = compareRoutes(
            canonicalHdRoutes[a.routeIndex]!,
            canonicalHdRoutes[b.routeIndex]!,
          )
          if (routeCmp !== 0) return routeCmp
        }
        return a.nextHash.localeCompare(b.nextHash)
      }),
    )
  }

  const queue = [startHash]
  const visitedHashes = new Set<string>([startHash])
  const prevByHash = new Map<
    string,
    { prevHash: string; routeIndex: number | null }
  >()

  while (queue.length > 0) {
    const currentHash = queue.shift()!
    if (currentHash === endHash) break

    for (const edge of adjacency.get(currentHash) ?? []) {
      if (visitedHashes.has(edge.nextHash)) continue
      visitedHashes.add(edge.nextHash)
      prevByHash.set(edge.nextHash, {
        prevHash: currentHash,
        routeIndex: edge.routeIndex,
      })
      queue.push(edge.nextHash)
    }
  }

  if (!visitedHashes.has(endHash)) return canonicalHdRoutes

  const selectedRouteIndexesInReverse: number[] = []
  let cursorHash = endHash
  while (cursorHash !== startHash) {
    const prev = prevByHash.get(cursorHash)
    if (!prev) return canonicalHdRoutes
    if (prev.routeIndex !== null) {
      selectedRouteIndexesInReverse.push(prev.routeIndex)
    }
    cursorHash = prev.prevHash
  }

  if (selectedRouteIndexesInReverse.length === 0) return params.hdRoutes

  const selectedHdRoutes = selectedRouteIndexesInReverse
    .reverse()
    .map((routeIndex) => canonicalHdRoutes[routeIndex]!)

  if (
    selectedHdRoutes.length > 0 &&
    !params.canStitchBetweenTerminals({
      connectionName: params.connectionName,
      hdRoutes: selectedHdRoutes,
      start: params.start,
      end: params.end,
    })
  ) {
    return canonicalHdRoutes
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
