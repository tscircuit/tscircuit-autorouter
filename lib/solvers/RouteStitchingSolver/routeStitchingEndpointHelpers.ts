import { distance, type Point3 } from "@tscircuit/math-utils"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { IsStitchSegmentClear } from "./route-stitch-clearance-validator"
import type { StitchClearanceMode } from "./SingleHighDensityRouteStitchSolver3"
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

type EndpointPathState = {
  hash: string
  routeIndex: number | null
  prev: EndpointPathState | null
}

export type CanStitchBetweenTerminals = (params: {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: Point3
  end: Point3
  stitchClearanceMode?: StitchClearanceMode
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

  constructor(private readonly preferSameLayerTerminalEndpoints = false) {}

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
    let bestHash: string | null = null
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
  adjacency: Map<EndpointPathState["hash"], EndpointEdge[]>,
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
  preferSameLayerTerminalEndpoints?: boolean
}) => {
  const sameLayerTerminals = params.terminals.filter(
    (terminal) => terminal.z === params.islandEndpoint.z,
  )
  if (
    params.preferSameLayerTerminalEndpoints &&
    sameLayerTerminals.length === 0
  ) {
    return params.islandEndpoint
  }
  const candidates = params.preferSameLayerTerminalEndpoints
    ? sameLayerTerminals
    : params.terminals
  const sortedTerminals = [...candidates].sort(comparePoints)
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

type EndpointGapValidation = {
  connectionName: string
  pointsByHash: Map<EndpointPathState["hash"], Point3>
  traceThickness: number
  isStitchSegmentClear: IsStitchSegmentClear
}

const findEndpointRouteIndexes = (params: {
  adjacency: Map<EndpointPathState["hash"], EndpointEdge[]>
  startHash: string
  endHash: string
  gapValidation?: EndpointGapValidation
}): number[] | null => {
  const queue: EndpointPathState[] = [
    { hash: params.startHash, routeIndex: null, prev: null },
  ]
  const visitedAfterRoute = new Set<string>([params.startHash])
  let visitedAfterGap = visitedAfterRoute
  if (params.gapValidation) visitedAfterGap = new Set<string>()
  let endState: EndpointPathState | null = null

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.hash === params.endHash) {
      endState = current
      break
    }

    for (const edge of params.adjacency.get(current.hash) ?? []) {
      const isGap = edge.routeIndex === null
      if (isGap && params.gapValidation) {
        // Consecutive gaps lose their relay point from selectedHdRoutes.
        if (current.prev !== null && current.routeIndex === null) continue
        if (
          !params.gapValidation.isStitchSegmentClear({
            connectionName: params.gapValidation.connectionName,
            start: params.gapValidation.pointsByHash.get(current.hash)!,
            end: params.gapValidation.pointsByHash.get(edge.nextHash)!,
            traceThickness: params.gapValidation.traceThickness,
          })
        )
          continue
      }
      let visited = visitedAfterRoute
      if (isGap) visited = visitedAfterGap
      if (visited.has(edge.nextHash)) continue
      visited.add(edge.nextHash)
      queue.push({
        hash: edge.nextHash,
        routeIndex: edge.routeIndex,
        prev: current,
      })
    }
  }

  if (!endState) return null

  const selectedRouteIndexesInReverse: number[] = []
  let cursor = endState
  while (cursor.prev !== null) {
    if (cursor.routeIndex !== null) {
      selectedRouteIndexesInReverse.push(cursor.routeIndex)
    }
    cursor = cursor.prev
  }

  return selectedRouteIndexesInReverse.reverse()
}

/**
 * Keeps successful deterministic selections and repairs gap paths only when
 * neither the selected subset nor the full collection reaches both terminals.
 */
export const selectRoutesAlongEndpointPath = (params: {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: Point3
  end: Point3
  endpointIndex: EndpointClusterIndex
  canStitchBetweenTerminals: CanStitchBetweenTerminals
  isStitchSegmentClear: IsStitchSegmentClear
}): HighDensityIntraNodeRoute[] => {
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

  const routeIndexes = findEndpointRouteIndexes({
    adjacency,
    startHash,
    endHash,
  })
  if (!routeIndexes) return canonicalHdRoutes
  if (routeIndexes.length === 0) return params.hdRoutes

  const selectedHdRoutes = routeIndexes.map(
    (routeIndex) => canonicalHdRoutes[routeIndex]!,
  )

  if (
    params.canStitchBetweenTerminals({
      connectionName: params.connectionName,
      hdRoutes: selectedHdRoutes,
      start: params.start,
      end: params.end,
    })
  )
    return selectedHdRoutes

  if (
    params.canStitchBetweenTerminals({
      connectionName: params.connectionName,
      hdRoutes: structuredClone(canonicalHdRoutes),
      start: params.start,
      end: params.end,
      stitchClearanceMode: "prefer_clear",
    })
  )
    return canonicalHdRoutes

  const repairedRouteIndexes = findEndpointRouteIndexes({
    adjacency,
    startHash,
    endHash,
    gapValidation: {
      connectionName: params.connectionName,
      pointsByHash: new Map(
        sortedEndpointClusters.map((endpoint) => [
          endpoint.key,
          endpoint.point,
        ]),
      ),
      traceThickness: canonicalHdRoutes[0]!.traceThickness,
      isStitchSegmentClear: params.isStitchSegmentClear,
    },
  })
  if (!repairedRouteIndexes || repairedRouteIndexes.length === 0)
    return canonicalHdRoutes

  const repairedHdRoutes = repairedRouteIndexes.map(
    (routeIndex) => canonicalHdRoutes[routeIndex]!,
  )
  if (
    params.canStitchBetweenTerminals({
      connectionName: params.connectionName,
      hdRoutes: repairedHdRoutes,
      start: params.start,
      end: params.end,
    })
  )
    return repairedHdRoutes

  return canonicalHdRoutes
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
