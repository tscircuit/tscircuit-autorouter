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

type EndpointKey = string
type EndpointGroupName = string
type EndpointBucketKey = string

type EndpointCluster = {
  key: EndpointKey
  point: Point3
}

type EndpointClusterCollection = {
  clusters: EndpointCluster[]
  clustersByBucketKey: Map<EndpointBucketKey, EndpointCluster[]>
}

type EndpointEdge = {
  nextHash: EndpointKey
  routeIndex: number | null
}

const getEndpointBucketKey = (
  point: Point3,
  bucketSize: number,
): EndpointBucketKey =>
  `${point.z}:${Math.floor(point.x / bucketSize)}:${Math.floor(point.y / bucketSize)}`

const getNeighborEndpointBucketKeys = (
  point: Point3,
  bucketSize: number,
): EndpointBucketKey[] => {
  const bucketX = Math.floor(point.x / bucketSize)
  const bucketY = Math.floor(point.y / bucketSize)
  const bucketKeys: EndpointBucketKey[] = []

  for (let xOffset = -1; xOffset <= 1; xOffset++) {
    for (let yOffset = -1; yOffset <= 1; yOffset++) {
      bucketKeys.push(`${point.z}:${bucketX + xOffset}:${bucketY + yOffset}`)
    }
  }

  return bucketKeys
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
    EndpointGroupName,
    EndpointClusterCollection
  >()

  constructor(private readonly preferSameLayerTerminalEndpoints = false) {}

  getEndpointKey(connectionName: string, point: Point3): EndpointKey {
    const clusterCollection = this.endpointClusters.get(connectionName) ?? {
      clusters: [],
      clustersByBucketKey: new Map<
        EndpointBucketKey,
        EndpointCluster[]
      >(),
    }

    let bestCluster: EndpointCluster | undefined
    let bestDistance = Infinity

    for (const bucketKey of getNeighborEndpointBucketKeys(
      point,
      ENDPOINT_MATCH_TOLERANCE,
    )) {
      for (const cluster of
        clusterCollection.clustersByBucketKey.get(bucketKey) ?? []) {
        const clusterDistance = distance(cluster.point, point)
        if (
          clusterDistance <= ENDPOINT_MATCH_TOLERANCE &&
          (clusterDistance < bestDistance - DISTANCE_TIE_TOLERANCE ||
            (Math.abs(clusterDistance - bestDistance) <=
              DISTANCE_TIE_TOLERANCE &&
              (!bestCluster ||
                comparePoints(cluster.point, bestCluster.point) < 0)))
        ) {
          bestCluster = cluster
          bestDistance = clusterDistance
        }
      }
    }

    if (bestCluster) {
      return bestCluster.key
    }

    const key = `${connectionName}:endpoint_${clusterCollection.clusters.length}`
    const cluster = {
      key,
      point: { x: point.x, y: point.y, z: point.z },
    }
    clusterCollection.clusters.push(cluster)
    const bucketKey = getEndpointBucketKey(point, ENDPOINT_MATCH_TOLERANCE)
    const bucketClusters =
      clusterCollection.clustersByBucketKey.get(bucketKey) ?? []
    bucketClusters.push(cluster)
    clusterCollection.clustersByBucketKey.set(bucketKey, bucketClusters)
    this.endpointClusters.set(connectionName, clusterCollection)
    return key
  }

  getClusters(connectionName: string): EndpointCluster[] {
    return this.endpointClusters.get(connectionName)?.clusters ?? []
  }

  getClosestEndpointKey(
    connectionName: string,
    routes: HighDensityIntraNodeRoute[],
    point: Point3,
  ): EndpointKey | null {
    const routeEndpoints = routes.flatMap((route) => [
      route.route[0]!,
      route.route[route.route.length - 1]!,
    ])
    const sameLayerEndpoints = routeEndpoints.filter(
      (endpoint) => endpoint.z === point.z,
    )
    const candidateEndpoints =
      this.preferSameLayerTerminalEndpoints && sameLayerEndpoints.length > 0
        ? sameLayerEndpoints
        : routeEndpoints
    let bestHash: EndpointKey | null = null
    let bestEndpoint: Point3 | null = null
    let bestDist = Infinity

    for (const endpoint of candidateEndpoints) {
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

    return bestHash
  }
}

const addAdjacencyEdge = (
  adjacency: Map<EndpointKey, EndpointEdge[]>,
  fromHash: EndpointKey,
  edge: EndpointEdge,
): void => {
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
const snapIslandEndpointToTerminal = (params: {
  islandEndpoint: Point3
  terminal: Point3
}): Point3 => {
  return distance(params.islandEndpoint, params.terminal) <=
    MAX_TERMINAL_STITCH_GAP_DISTANCE_3
    ? params.terminal
    : params.islandEndpoint
}

const snapIslandEndpointToNearestTerminal = (params: {
  islandEndpoint: Point3
  terminals: Point3[]
}): Point3 => {
  const sortedTerminals = [...params.terminals].sort(comparePoints)
  let closestTerminal = sortedTerminals[0]
  let closestDistance = distance(params.islandEndpoint, closestTerminal)

  for (const terminal of sortedTerminals.slice(1)) {
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
 * Preserves the established nearest-terminal snapping, but prevents two
 * distinct connection endpoints from collapsing onto one terminal.
 */
export const snapIslandEndpointsToDistinctTerminals = (params: {
  start: Point3 & { pcb_port_id?: string }
  end: Point3 & { pcb_port_id?: string }
  globalStart: Point3 & { pcb_port_id?: string }
  globalEnd: Point3 & { pcb_port_id?: string }
}): {
  start: Point3 & { pcb_port_id?: string }
  end: Point3 & { pcb_port_id?: string }
} => {
  const terminals = [params.globalStart, params.globalEnd]
  const start = snapIslandEndpointToNearestTerminal({
    islandEndpoint: params.start,
    terminals,
  })
  const end = snapIslandEndpointToNearestTerminal({
    islandEndpoint: params.end,
    terminals,
  })
  const terminalsNeedIdentityDisambiguation =
    start === end &&
    params.globalStart.pcb_port_id !== undefined &&
    params.globalEnd.pcb_port_id !== undefined &&
    params.globalStart.pcb_port_id !== params.globalEnd.pcb_port_id &&
    params.globalStart.z !== params.globalEnd.z
  if (!terminalsNeedIdentityDisambiguation) return { start, end }

  return {
    start: snapIslandEndpointToTerminal({
      islandEndpoint: params.start,
      terminal: params.globalStart,
    }),
    end: snapIslandEndpointToTerminal({
      islandEndpoint: params.end,
      terminal: params.globalEnd,
    }),
  }
}

/**
 * Returns the route islands on the deterministic endpoint path between the
 * chosen terminals. If the subset cannot actually stitch to both terminals,
 * the full route set is returned instead.
 */
export class RouteEndpointPathIndex {
  private readonly hdRoutes: HighDensityIntraNodeRoute[]
  private readonly canonicalHdRoutes: HighDensityIntraNodeRoute[]
  private readonly adjacency = new Map<EndpointKey, EndpointEdge[]>()

  constructor(
    private readonly options: {
      endpointGroupName: EndpointGroupName
      hdRoutes: HighDensityIntraNodeRoute[]
      endpointIndex: EndpointClusterIndex
    },
  ) {
    this.hdRoutes = options.hdRoutes
    this.canonicalHdRoutes = [...options.hdRoutes].sort(compareRoutes)

    for (
      let routeIndex = 0;
      routeIndex < this.canonicalHdRoutes.length;
      routeIndex++
    ) {
      const route = this.canonicalHdRoutes[routeIndex]!
      const routeStartHash = options.endpointIndex.getEndpointKey(
        options.endpointGroupName,
        route.route[0]!,
      )
      const routeEndHash = options.endpointIndex.getEndpointKey(
        options.endpointGroupName,
        route.route[route.route.length - 1]!,
      )

      addAdjacencyEdge(this.adjacency, routeStartHash, {
        nextHash: routeEndHash,
        routeIndex,
      })
      addAdjacencyEdge(this.adjacency, routeEndHash, {
        nextHash: routeStartHash,
        routeIndex,
      })
    }

    const sortedEndpointClusters = [
      ...options.endpointIndex.getClusters(options.endpointGroupName),
    ].sort((endpointA, endpointB) =>
      comparePoints(endpointA.point, endpointB.point),
    )
    const nearbyClustersByBucketKey = new Map<
      EndpointBucketKey,
      EndpointCluster[]
    >()
    for (const endpointA of sortedEndpointClusters) {
      for (const bucketKey of getNeighborEndpointBucketKeys(
        endpointA.point,
        MAX_STITCH_GAP_DISTANCE_3,
      )) {
        for (const endpointB of nearbyClustersByBucketKey.get(bucketKey) ?? []) {
          if (
            distance(endpointA.point, endpointB.point) >
            MAX_STITCH_GAP_DISTANCE_3
          )
            continue

          addAdjacencyEdge(this.adjacency, endpointA.key, {
            nextHash: endpointB.key,
            routeIndex: null,
          })
          addAdjacencyEdge(this.adjacency, endpointB.key, {
            nextHash: endpointA.key,
            routeIndex: null,
          })
        }
      }

      const bucketKey = getEndpointBucketKey(
        endpointA.point,
        MAX_STITCH_GAP_DISTANCE_3,
      )
      const nearbyClusters = nearbyClustersByBucketKey.get(bucketKey) ?? []
      nearbyClusters.push(endpointA)
      nearbyClustersByBucketKey.set(bucketKey, nearbyClusters)
    }

    for (const [endpointKey, edges] of this.adjacency.entries()) {
      this.adjacency.set(
        endpointKey,
        [...edges].sort((edgeA, edgeB) => {
          if (edgeA.routeIndex === null && edgeB.routeIndex !== null) return 1
          if (edgeA.routeIndex !== null && edgeB.routeIndex === null) return -1
          if (edgeA.routeIndex !== null && edgeB.routeIndex !== null) {
            const routeCmp = compareRoutes(
              this.canonicalHdRoutes[edgeA.routeIndex]!,
              this.canonicalHdRoutes[edgeB.routeIndex]!,
            )
            if (routeCmp !== 0) return routeCmp
          }
          return edgeA.nextHash.localeCompare(edgeB.nextHash)
        }),
      )
    }
  }

  selectRoutes(options: {
    connectionName: string
    start: Point3
    end: Point3
    canStitchBetweenTerminals: CanStitchBetweenTerminals
  }): HighDensityIntraNodeRoute[] {
    if (this.hdRoutes.length <= 2) return this.hdRoutes

    const startHash = this.options.endpointIndex.getClosestEndpointKey(
      this.options.endpointGroupName,
      this.canonicalHdRoutes,
      options.start,
    )
    const endHash = this.options.endpointIndex.getClosestEndpointKey(
      this.options.endpointGroupName,
      this.canonicalHdRoutes,
      options.end,
    )

    if (!startHash || !endHash || startHash === endHash) {
      return this.canonicalHdRoutes
    }

    const queue = [startHash]
    const visitedHashes = new Set<EndpointKey>([startHash])
    const prevByHash = new Map<
      EndpointKey,
      { prevHash: EndpointKey; routeIndex: number | null }
    >()

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      const currentHash = queue[queueIndex]!
      if (currentHash === endHash) break

      for (const edge of this.adjacency.get(currentHash) ?? []) {
        if (visitedHashes.has(edge.nextHash)) continue
        visitedHashes.add(edge.nextHash)
        prevByHash.set(edge.nextHash, {
          prevHash: currentHash,
          routeIndex: edge.routeIndex,
        })
        queue.push(edge.nextHash)
      }
    }

    if (!visitedHashes.has(endHash)) return this.canonicalHdRoutes

    const selectedRouteIndexesInReverse: number[] = []
    let cursorHash = endHash
    while (cursorHash !== startHash) {
      const previousEndpoint = prevByHash.get(cursorHash)
      if (!previousEndpoint) return this.canonicalHdRoutes
      if (previousEndpoint.routeIndex !== null) {
        selectedRouteIndexesInReverse.push(previousEndpoint.routeIndex)
      }
      cursorHash = previousEndpoint.prevHash
    }

    if (selectedRouteIndexesInReverse.length === 0) return this.hdRoutes

    const selectedHdRoutes = selectedRouteIndexesInReverse
      .reverse()
      .map((routeIndex) => this.canonicalHdRoutes[routeIndex]!)

    if (
      selectedHdRoutes.length > 0 &&
      !options.canStitchBetweenTerminals({
        connectionName: options.connectionName,
        hdRoutes: selectedHdRoutes,
        start: options.start,
        end: options.end,
      })
    ) {
      return this.canonicalHdRoutes
    }

    return selectedHdRoutes
  }
}

export const selectRoutesAlongEndpointPath = (options: {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: Point3
  end: Point3
  endpointIndex: EndpointClusterIndex
  canStitchBetweenTerminals: CanStitchBetweenTerminals
}): HighDensityIntraNodeRoute[] =>
  new RouteEndpointPathIndex({
    endpointGroupName: options.connectionName,
    hdRoutes: options.hdRoutes,
    endpointIndex: options.endpointIndex,
  }).selectRoutes(options)

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
