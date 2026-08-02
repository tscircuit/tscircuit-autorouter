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
  nextHash: EndpointKey
  routeIndex: number | null
}

type ConnectionName = string
export type EndpointKey = string
type SearchStateKey = string
type SearchState = {
  hash: EndpointKey
  lastEdgeWasGap: boolean
}
type PathTransition = {
  prevStateKey: SearchStateKey
  fromHash: EndpointKey
  toHash: EndpointKey
  routeIndex: number | null
}

export type StitchRepairPolicy = "validated_only" | "allow_drc_repair"

export type EndpointPathSelection = {
  hdRoutes: HighDensityIntraNodeRoute[]
  stitchRepairPolicy: StitchRepairPolicy
}

export type GetStitchRepairPolicyBetweenTerminals = (params: {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: Point3
  end: Point3
}) => StitchRepairPolicy | null

export type IsValidStitchGap = (params: {
  connectionName: string
  start: Point3
  end: Point3
}) => boolean

/**
 * Maintains a deterministic cluster map for route endpoints so different route
 * fragments that terminate at effectively the same location share one key.
 */
export class EndpointClusterIndex {
  private endpointClusters = new Map<
    ConnectionName,
    Array<{ key: EndpointKey; point: Point3 }>
  >()

  getEndpointKey(connectionName: string, point: Point3): EndpointKey {
    const clusters = this.endpointClusters.get(connectionName) ?? []

    let bestCluster: { key: EndpointKey; point: Point3 } | undefined
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

  getClusters(
    connectionName: string,
  ): Array<{ key: EndpointKey; point: Point3 }> {
    return this.endpointClusters.get(connectionName) ?? []
  }

  getClosestEndpointKey(
    connectionName: string,
    routes: HighDensityIntraNodeRoute[],
    point: Point3,
  ): EndpointKey | null {
    let bestHash: EndpointKey | null = null
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

const isValidTerminalGap = ({
  terminal,
  endpoint,
  connectionName,
  isValidStitchGap,
}: {
  terminal: Point3
  endpoint: Point3
  connectionName: string
  isValidStitchGap?: IsValidStitchGap
}): boolean => {
  const terminalDistance = distance(terminal, endpoint)
  if (terminalDistance <= ENDPOINT_MATCH_TOLERANCE) return true
  if (terminalDistance > MAX_TERMINAL_STITCH_GAP_DISTANCE_3) return false
  if (terminal.z !== endpoint.z) return false
  return (
    !isValidStitchGap ||
    isValidStitchGap({
      connectionName,
      start: terminal,
      end: endpoint,
    })
  )
}

const findCandidatePath = ({
  adjacency,
  startState,
  startStateKey,
  endHash,
  endRequiresGap,
}: {
  adjacency: Map<EndpointKey, EndpointEdge[]>
  startState: SearchState
  startStateKey: SearchStateKey
  endHash: EndpointKey
  endRequiresGap: boolean
}): PathTransition[] | null => {
  const queue = [startState]
  const visitedStateKeys = new Set<SearchStateKey>([startStateKey])
  const prevByStateKey = new Map<SearchStateKey, PathTransition>()
  let endStateKey: SearchStateKey | null = null

  while (queue.length > 0) {
    const currentState = queue.shift()!
    const currentStateKey = `${currentState.hash}:${currentState.lastEdgeWasGap ? "gap" : "route"}`
    if (
      currentState.hash === endHash &&
      !(endRequiresGap && currentState.lastEdgeWasGap)
    ) {
      endStateKey = currentStateKey
      break
    }

    for (const edge of adjacency.get(currentState.hash) ?? []) {
      const edgeIsGap = edge.routeIndex === null
      if (edgeIsGap && currentState.lastEdgeWasGap) continue
      const nextState: SearchState = {
        hash: edge.nextHash,
        lastEdgeWasGap: edgeIsGap,
      }
      const nextStateKey = `${nextState.hash}:${nextState.lastEdgeWasGap ? "gap" : "route"}`
      if (visitedStateKeys.has(nextStateKey)) continue
      visitedStateKeys.add(nextStateKey)
      prevByStateKey.set(nextStateKey, {
        prevStateKey: currentStateKey,
        fromHash: currentState.hash,
        toHash: edge.nextHash,
        routeIndex: edge.routeIndex,
      })
      queue.push(nextState)
    }
  }

  if (!endStateKey) return null

  const transitionsInReverse: PathTransition[] = []
  for (let cursorStateKey = endStateKey; cursorStateKey !== startStateKey; ) {
    const transition = prevByStateKey.get(cursorStateKey)
    if (!transition) return null
    transitionsInReverse.push(transition)
    cursorStateKey = transition.prevStateKey
  }
  return transitionsInReverse.reverse()
}

const getRoutesFromTransitions = ({
  transitions,
  hdRoutes,
}: {
  transitions: PathTransition[]
  hdRoutes: HighDensityIntraNodeRoute[]
}): HighDensityIntraNodeRoute[] => {
  return transitions
    .filter(
      (transition): transition is PathTransition & { routeIndex: number } =>
        transition.routeIndex !== null,
    )
    .map((transition) => hdRoutes[transition.routeIndex]!)
}

/**
 * Chooses the island endpoints that best align to the requested connection
 * terminals, with deterministic tie-breaking.
 */
export const selectIslandEndpoints = (params: {
  possibleEndpoints: Point3[]
  globalStart: Point3
  globalEnd: Point3
}): { start: Point3; end: Point3 } => {
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
  getStitchRepairPolicyBetweenTerminals: GetStitchRepairPolicyBetweenTerminals
  isValidStitchGap?: IsValidStitchGap
  stitchRepairPolicy?: StitchRepairPolicy
}): EndpointPathSelection => {
  const requestedRepairPolicy = params.stitchRepairPolicy ?? "validated_only"

  if (params.hdRoutes.length <= 2) {
    return {
      hdRoutes: params.hdRoutes,
      stitchRepairPolicy: requestedRepairPolicy,
    }
  }

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
    return {
      hdRoutes: canonicalHdRoutes,
      stitchRepairPolicy: requestedRepairPolicy,
    }
  }

  const endpointClusters = params.endpointIndex.getClusters(
    params.connectionName,
  )
  const startEndpoint = endpointClusters.find(
    (cluster) => cluster.key === startHash,
  )?.point
  const endEndpoint = endpointClusters.find(
    (cluster) => cluster.key === endHash,
  )?.point
  if (!startEndpoint || !endEndpoint) {
    return {
      hdRoutes: canonicalHdRoutes,
      stitchRepairPolicy: requestedRepairPolicy,
    }
  }

  if (
    !isValidTerminalGap({
      terminal: params.start,
      endpoint: startEndpoint,
      connectionName: params.connectionName,
      isValidStitchGap: params.isValidStitchGap,
    }) ||
    !isValidTerminalGap({
      terminal: params.end,
      endpoint: endEndpoint,
      connectionName: params.connectionName,
      isValidStitchGap: params.isValidStitchGap,
    })
  ) {
    return {
      hdRoutes: canonicalHdRoutes,
      stitchRepairPolicy: requestedRepairPolicy,
    }
  }

  const startRequiresGap =
    distance(params.start, startEndpoint) > ENDPOINT_MATCH_TOLERANCE
  const endRequiresGap =
    distance(params.end, endEndpoint) > ENDPOINT_MATCH_TOLERANCE

  const adjacency = new Map<EndpointKey, EndpointEdge[]>()

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

  const startState: SearchState = {
    hash: startHash,
    lastEdgeWasGap: startRequiresGap,
  }
  const startStateKey = `${startState.hash}:${startState.lastEdgeWasGap ? "gap" : "route"}`

  const endpointByHash = new Map<EndpointKey, Point3>(
    sortedEndpointClusters.map((cluster) => [cluster.key, cluster.point]),
  )

  let selectedHdRoutes: HighDensityIntraNodeRoute[] = []
  let provisionalHdRoutes: HighDensityIntraNodeRoute[] | undefined
  while (true) {
    const transitions = findCandidatePath({
      adjacency,
      startState,
      startStateKey,
      endHash,
      endRequiresGap,
    })
    if (!transitions) {
      if (requestedRepairPolicy === "allow_drc_repair") {
        return {
          hdRoutes: provisionalHdRoutes ?? canonicalHdRoutes,
          stitchRepairPolicy: "allow_drc_repair",
        }
      }
      return {
        hdRoutes: canonicalHdRoutes,
        stitchRepairPolicy: "validated_only",
      }
    }
    if (requestedRepairPolicy === "allow_drc_repair" && !provisionalHdRoutes) {
      provisionalHdRoutes = getRoutesFromTransitions({
        transitions,
        hdRoutes: canonicalHdRoutes,
      })
    }

    const invalidGap = transitions.find((transition) => {
      if (transition.routeIndex !== null || !params.isValidStitchGap) {
        return false
      }
      const start = endpointByHash.get(transition.fromHash)
      const end = endpointByHash.get(transition.toHash)
      if (!start || !end) return true
      return !params.isValidStitchGap!({
        connectionName: params.connectionName,
        start,
        end,
      })
    })

    if (invalidGap) {
      adjacency.set(
        invalidGap.fromHash,
        (adjacency.get(invalidGap.fromHash) ?? []).filter(
          (edge) =>
            edge.routeIndex !== null || edge.nextHash !== invalidGap.toHash,
        ),
      )
      adjacency.set(
        invalidGap.toHash,
        (adjacency.get(invalidGap.toHash) ?? []).filter(
          (edge) =>
            edge.routeIndex !== null || edge.nextHash !== invalidGap.fromHash,
        ),
      )
      continue
    }

    selectedHdRoutes = getRoutesFromTransitions({
      transitions,
      hdRoutes: canonicalHdRoutes,
    })
    break
  }

  if (selectedHdRoutes.length === 0) {
    return {
      hdRoutes: params.hdRoutes,
      stitchRepairPolicy: requestedRepairPolicy,
    }
  }

  const selectedRepairPolicy = params.getStitchRepairPolicyBetweenTerminals({
    connectionName: params.connectionName,
    hdRoutes: selectedHdRoutes,
    start: params.start,
    end: params.end,
  })
  if (!selectedRepairPolicy) {
    if (params.isValidStitchGap) {
      return {
        hdRoutes: selectedHdRoutes,
        stitchRepairPolicy: requestedRepairPolicy,
      }
    }
    return {
      hdRoutes: canonicalHdRoutes,
      stitchRepairPolicy: requestedRepairPolicy,
    }
  }

  return {
    hdRoutes: selectedHdRoutes,
    stitchRepairPolicy: selectedRepairPolicy,
  }
}

export const hasStitchableGapBetweenUnsolvedRoutes = (
  unsolvedRoutes: Array<{ start: Point3; end: Point3 }>,
): boolean => {
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
