import { distance, type Point3 } from "@tscircuit/math-utils"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getRouteStitchEndpoint } from "./getRouteStitchEndpoint"
import type { StitchTerminal } from "./getStitchTerminal"
import type { IsStitchSegmentClear } from "./route-stitch-clearance-validator"
import { selectDirectedRouteStitchPath } from "./selectDirectedRouteStitchPath"
import {
  comparePoints,
  DISTANCE_TIE_TOLERANCE,
  MAX_STITCH_GAP_DISTANCE_3,
  MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
} from "./routeStitchingShared"

/**
 * Endpoints within this tolerance are treated as the same island endpoint.
 */
export const ENDPOINT_MATCH_TOLERANCE = 0.1

export type OrderedRouteStitchEntry = {
  route: HighDensityIntraNodeRoute
  matchedOn: "first" | "last"
}

export type RouteStitchPathSelection = {
  hdRoutes: HighDensityIntraNodeRoute[]
  orderedRoutePath?: OrderedRouteStitchEntry[]
}

type EndpointCluster = { key: string; point: StitchTerminal }

export type CanStitchBetweenTerminals = (params: {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: StitchTerminal
  end: StitchTerminal
  orderedRoutePath?: OrderedRouteStitchEntry[]
}) => boolean

/**
 * Maintains a deterministic cluster map for route endpoints so different route
 * fragments that terminate at effectively the same location share one key.
 */
export class EndpointClusterIndex {
  private endpointClusters = new Map<string, EndpointCluster[]>()
  private assignedEndpointKeys = new Map<string, Map<string, string>>()

  constructor(private readonly preferSameLayerTerminalEndpoints = false) {}

  getEndpointKey(connectionName: string, point: StitchTerminal): string {
    const pointIdentity = JSON.stringify([
      point.x,
      point.y,
      point.z,
      point.pcb_port_id,
    ])
    const assignedKeys =
      this.assignedEndpointKeys.get(connectionName) ?? new Map<string, string>()
    const assignedKey = assignedKeys.get(pointIdentity)
    if (assignedKey !== undefined) return assignedKey
    const clusters = this.endpointClusters.get(connectionName) ?? []

    let bestCluster: EndpointCluster | undefined
    let bestDistance = Infinity

    for (const cluster of clusters) {
      if (cluster.point.z !== point.z) continue
      // Nearby same-net pads can overlap while remaining distinct terminals.
      // Their route boundaries must not lose identity through fuzzy matching.
      if (
        cluster.point.pcb_port_id &&
        point.pcb_port_id &&
        cluster.point.pcb_port_id !== point.pcb_port_id
      ) {
        continue
      }
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
      if (!bestCluster.point.pcb_port_id && point.pcb_port_id) {
        bestCluster.point = {
          ...bestCluster.point,
          pcb_port_id: point.pcb_port_id,
        }
      }
      assignedKeys.set(pointIdentity, bestCluster.key)
      this.assignedEndpointKeys.set(connectionName, assignedKeys)
      return bestCluster.key
    }

    const key = `${connectionName}:endpoint_${clusters.length}`
    clusters.push({
      key,
      point: { ...point },
    })
    assignedKeys.set(pointIdentity, key)
    this.assignedEndpointKeys.set(connectionName, assignedKeys)
    this.endpointClusters.set(connectionName, clusters)
    return key
  }

  getClusters(connectionName: string): EndpointCluster[] {
    return this.endpointClusters.get(connectionName) ?? []
  }

  getClosestEndpointKey(
    connectionName: string,
    routes: HighDensityIntraNodeRoute[],
    point: StitchTerminal,
  ): string | null {
    const routeEndpoints = routes.flatMap((route) => [
      getRouteStitchEndpoint(route, "first"),
      getRouteStitchEndpoint(route, "last"),
    ])
    const claimedEndpoints = point.pcb_port_id
      ? routeEndpoints.filter(
          (endpoint): boolean => endpoint.pcb_port_id === point.pcb_port_id,
        )
      : []
    const matchingEndpoints =
      claimedEndpoints.length > 0 ? claimedEndpoints : routeEndpoints
    const sameLayerEndpoints = matchingEndpoints.filter(
      (endpoint) => endpoint.z === point.z,
    )
    const candidateEndpoints =
      this.preferSameLayerTerminalEndpoints && sameLayerEndpoints.length > 0
        ? sameLayerEndpoints
        : matchingEndpoints
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

/**
 * Chooses the island endpoints that best align to the requested connection
 * terminals, with deterministic tie-breaking.
 */
export const selectIslandEndpoints = (params: {
  possibleEndpoints: StitchTerminal[]
  globalStart: StitchTerminal
  globalEnd: StitchTerminal
}): { start: StitchTerminal; end: StitchTerminal } => {
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
  islandEndpoint: StitchTerminal
  terminals: StitchTerminal[]
}): StitchTerminal => {
  if (params.islandEndpoint.pcb_port_id) {
    const claimedTerminal = params.terminals.find(
      (terminal): boolean =>
        terminal.pcb_port_id === params.islandEndpoint.pcb_port_id,
    )
    if (!claimedTerminal) {
      throw new Error(
        `Route stitching found unknown PCB terminal "${params.islandEndpoint.pcb_port_id}" on an island endpoint`,
      )
    }
    return claimedTerminal
  }
  // A nearby boundary on another layer is not a physical terminal claim.
  // Keep it as an island boundary instead of inventing a terminal transition.
  const sortedTerminals = params.terminals
    .filter(
      (terminal): boolean =>
        terminal.z === params.islandEndpoint.z ||
        terminal.availableZ?.includes(params.islandEndpoint.z) === true,
    )
    .sort(comparePoints)
  if (sortedTerminals.length === 0) return params.islandEndpoint
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
 * chosen terminals, minimizing newly introduced gaps before route hops.
 * A rejected path must not become an unvalidated superset of route islands.
 */
export const selectRoutesAlongEndpointPath = (params: {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: StitchTerminal
  end: StitchTerminal
  endpointIndex: EndpointClusterIndex
  isStitchSegmentClear: IsStitchSegmentClear
  canStitchBetweenTerminals: CanStitchBetweenTerminals
}): RouteStitchPathSelection | null => {
  if (params.hdRoutes.length <= 2) return { hdRoutes: params.hdRoutes }

  const orderedRoutePath = selectDirectedRouteStitchPath(params)
  if (!orderedRoutePath) return null
  const selectedHdRoutes = orderedRoutePath.map(
    (entry): HighDensityIntraNodeRoute => entry.route,
  )
  if (
    !params.canStitchBetweenTerminals({
      connectionName: params.connectionName,
      hdRoutes: selectedHdRoutes,
      start: params.start,
      end: params.end,
      orderedRoutePath,
    })
  ) {
    throw new Error(
      `Selected route stitching path for "${params.connectionName}" cannot connect its terminals without violating stitch constraints`,
    )
  }
  return { hdRoutes: selectedHdRoutes, orderedRoutePath }
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
