import { distance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "connectivity-map"
import { GraphicsObject } from "graphics-debug"
import { SimpleRouteConnection } from "lib/types"
import { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getConnectionPointLayer } from "lib/types/srj-types"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { BaseSolver } from "../BaseSolver"
import { safeTransparentize } from "../colors"
import {
  MAX_STITCH_GAP_DISTANCE_3,
  MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
  SingleHighDensityRouteStitchSolver3,
} from "./SingleHighDensityRouteStitchSolver3"

export type UnsolvedRoute3 = {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: { x: number; y: number; z: number }
  end: { x: number; y: number; z: number }
}

const ENDPOINT_MATCH_TOLERANCE = 0.1
const DISTANCE_TIE_TOLERANCE = 1e-9
type Point3 = { x: number; y: number; z: number }

const compareNumbers = (a: number, b: number) => {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

const comparePoints = (a: Point3, b: Point3) =>
  compareNumbers(a.z, b.z) ||
  compareNumbers(a.x, b.x) ||
  compareNumbers(a.y, b.y)

const pointKey = (point: Point3) =>
  `${point.z.toFixed(6)}:${point.x.toFixed(6)}:${point.y.toFixed(6)}`

const getCanonicalRoutePointKeys = (route: HighDensityIntraNodeRoute) => {
  const forwardKey = route.route.map(pointKey).join("|")
  const reverseKey = [...route.route].reverse().map(pointKey).join("|")
  return forwardKey <= reverseKey ? forwardKey : reverseKey
}

const compareRoutes = (
  a: HighDensityIntraNodeRoute,
  b: HighDensityIntraNodeRoute,
) => {
  const connectionNameCmp = a.connectionName.localeCompare(b.connectionName)
  if (connectionNameCmp !== 0) return connectionNameCmp

  const rootConnectionNameCmp = (a.rootConnectionName ?? "").localeCompare(
    b.rootConnectionName ?? "",
  )
  if (rootConnectionNameCmp !== 0) return rootConnectionNameCmp

  const routeKeyCmp = getCanonicalRoutePointKeys(a).localeCompare(
    getCanonicalRoutePointKeys(b),
  )
  if (routeKeyCmp !== 0) return routeKeyCmp

  return (
    compareNumbers(a.traceThickness, b.traceThickness) ||
    compareNumbers(a.viaDiameter, b.viaDiameter) ||
    compareNumbers(a.route.length, b.route.length) ||
    compareNumbers(a.vias.length, b.vias.length) ||
    compareNumbers(a.jumpers?.length ?? 0, b.jumpers?.length ?? 0)
  )
}

export class MultipleHighDensityRouteStitchSolver3 extends BaseSolver {
  override getSolverName(): string {
    return "MultipleHighDensityRouteStitchSolver3"
  }

  unsolvedRoutes: UnsolvedRoute3[]
  activeSolver: SingleHighDensityRouteStitchSolver3 | null = null
  mergedHdRoutes: HighDensityIntraNodeRoute[] = []
  colorMap: Record<string, string> = {}
  defaultTraceThickness: number
  defaultViaDiameter: number
  private endpointClusters = new Map<
    string,
    Array<{ key: string; point: Point3 }>
  >()

  private getEndpointKey(
    connectionName: string,
    point: Point3,
  ) {
    const clusters = this.endpointClusters.get(connectionName) ?? []

    let bestCluster:
      | { key: string; point: Point3 }
      | undefined
    let bestDistance = Infinity

    for (const cluster of clusters) {
      if (cluster.point.z !== point.z) continue
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

  private getClosestEndpointHash(
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

  private selectRoutesAlongEndpointPath(
    connectionName: string,
    hdRoutes: HighDensityIntraNodeRoute[],
    start: Point3,
    end: Point3,
  ) {
    if (hdRoutes.length <= 2) return hdRoutes

    const canonicalHdRoutes = [...hdRoutes].sort(compareRoutes)

    const startHash = this.getClosestEndpointHash(
      connectionName,
      canonicalHdRoutes,
      start,
    )
    const endHash = this.getClosestEndpointHash(
      connectionName,
      canonicalHdRoutes,
      end,
    )

    if (!startHash || !endHash || startHash === endHash) return canonicalHdRoutes

    const adjacency = new Map<
      string,
      Array<{ nextHash: string; routeIndex: number | null }>
    >()

    const addAdjacencyEdge = (
      fromHash: string,
      edge: { nextHash: string; routeIndex: number | null },
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

    for (let i = 0; i < canonicalHdRoutes.length; i++) {
      const route = canonicalHdRoutes[i]!
      const routeStartHash = this.getEndpointKey(
        connectionName,
        route.route[0]!,
      )
      const routeEndHash = this.getEndpointKey(
        connectionName,
        route.route[route.route.length - 1]!,
      )

      addAdjacencyEdge(routeStartHash, {
        nextHash: routeEndHash,
        routeIndex: i,
      })
      addAdjacencyEdge(routeEndHash, {
        nextHash: routeStartHash,
        routeIndex: i,
      })
    }

    const endpointClusters = this.endpointClusters.get(connectionName) ?? []
    const sortedEndpointClusters = [...endpointClusters].sort((a, b) =>
      comparePoints(a.point, b.point),
    )
    for (let i = 0; i < sortedEndpointClusters.length; i++) {
      const endpointA = sortedEndpointClusters[i]!
      for (let j = i + 1; j < sortedEndpointClusters.length; j++) {
        const endpointB = sortedEndpointClusters[j]!
        if (endpointA.point.z !== endpointB.point.z) continue
        if (
          distance(endpointA.point, endpointB.point) > MAX_STITCH_GAP_DISTANCE_3
        )
          continue

        addAdjacencyEdge(endpointA.key, {
          nextHash: endpointB.key,
          routeIndex: null,
        })
        addAdjacencyEdge(endpointB.key, {
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

    if (selectedRouteIndexesInReverse.length === 0) return hdRoutes

    const selectedHdRoutes = selectedRouteIndexesInReverse
      .reverse()
      .map((routeIndex) => canonicalHdRoutes[routeIndex]!)

    if (
      selectedHdRoutes.length > 0 &&
      !this.canStitchBetweenTerminals(
        connectionName,
        selectedHdRoutes,
        start,
        end,
      )
    ) {
      return canonicalHdRoutes
    }

    return selectedHdRoutes
  }

  private canStitchBetweenTerminals(
    connectionName: string,
    hdRoutes: HighDensityIntraNodeRoute[],
    start: Point3,
    end: Point3,
  ) {
    const stitchSolver = new SingleHighDensityRouteStitchSolver3({
      connectionName,
      hdRoutes,
      start,
      end,
      colorMap: this.colorMap,
      defaultTraceThickness: this.defaultTraceThickness,
      defaultViaDiameter: this.defaultViaDiameter,
    })

    while (
      !stitchSolver.solved &&
      !stitchSolver.failed &&
      stitchSolver.iterations < stitchSolver.MAX_ITERATIONS
    ) {
      stitchSolver.step()
    }

    if (stitchSolver.failed) return false

    const routeStart = stitchSolver.mergedHdRoute.route[0]
    const routeEnd =
      stitchSolver.mergedHdRoute.route[
        stitchSolver.mergedHdRoute.route.length - 1
      ]

    const directDistance = distance(routeStart, start) + distance(routeEnd, end)
    const swappedDistance =
      distance(routeStart, end) + distance(routeEnd, start)

    return (
      Math.min(directDistance, swappedDistance) <=
      MAX_TERMINAL_STITCH_GAP_DISTANCE_3
    )
  }

  private selectIslandEndpoints(params: {
    possibleEndpoints: Point3[]
    globalStart: Point3
    globalEnd: Point3
  }) {
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

    const remainingEndpoints = sortedEndpoints.filter(
      (point) => point !== start,
    )

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

  private snapIslandEndpointToNearestTerminal(params: {
    islandEndpoint: Point3
    terminals: Point3[]
  }) {
    let closestTerminal = [...params.terminals].sort(comparePoints)[0]
    let closestDistance = distance(params.islandEndpoint, closestTerminal)

    for (const terminal of params.terminals.slice(1)) {
      const terminalDistance = distance(params.islandEndpoint, terminal)
      if (
        terminalDistance < closestDistance - DISTANCE_TIE_TOLERANCE ||
        (Math.abs(terminalDistance - closestDistance) <=
          DISTANCE_TIE_TOLERANCE &&
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

  private hasStitchableGapBetweenUnsolvedRoutes(
    unsolvedRoutes: UnsolvedRoute3[],
  ) {
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

  constructor(params: {
    connections: SimpleRouteConnection[]
    hdRoutes: HighDensityIntraNodeRoute[]
    colorMap?: Record<string, string>
    layerCount: number
    defaultViaDiameter?: number
  }) {
    super()
    this.colorMap = params.colorMap ?? {}

    const canonicalHdRoutes = [...params.hdRoutes].sort(compareRoutes)

    const firstRoute = canonicalHdRoutes[0]
    this.defaultTraceThickness = firstRoute?.traceThickness ?? 0.15
    this.defaultViaDiameter =
      firstRoute?.viaDiameter ?? params.defaultViaDiameter ?? 0.3

    const routeIslandConnectivityMap = new ConnectivityMap({})
    const routeIslandConnections: Array<string[]> = []
    const pointHashCounts = new Map<string, number>()

    for (let i = 0; i < canonicalHdRoutes.length; i++) {
      const hdRoute = canonicalHdRoutes[i]
      const start = hdRoute.route[0]
      const end = hdRoute.route[hdRoute.route.length - 1]
      routeIslandConnections.push([
        `route_island_${i}`,
        this.getEndpointKey(hdRoute.connectionName, start),
        this.getEndpointKey(hdRoute.connectionName, end),
      ])
    }
    routeIslandConnectivityMap.addConnections(routeIslandConnections)
    for (const routeIslandConnection of routeIslandConnections) {
      for (const pointHash of routeIslandConnection.slice(1)) {
        pointHashCounts.set(
          pointHash,
          (pointHashCounts.get(pointHash) ?? 0) + 1,
        )
      }
    }

    this.unsolvedRoutes = []

    const uniqueNets = Array.from(
      new Set(Object.values(routeIslandConnectivityMap.idToNetMap)),
    )

    for (const netName of uniqueNets) {
      const netMembers =
        routeIslandConnectivityMap.getIdsConnectedToNet(netName)

      const hdRoutes = canonicalHdRoutes.filter((r, i) =>
        netMembers.includes(`route_island_${i}`),
      )
      if (hdRoutes.length === 0) continue

      const connection = params.connections.find(
        (c) => c.name === hdRoutes[0].connectionName,
      )!

      const possibleEndpoints1 = hdRoutes.flatMap((r) => [
        r.route[0],
        r.route[r.route.length - 1],
      ])

      const possibleEndpointsByHash = new Map<
        string,
        { x: number; y: number; z: number }
      >()
      const possibleEndpoints2 = []
      for (const possibleEndpoint1 of possibleEndpoints1) {
        const pointHash = this.getEndpointKey(
          hdRoutes[0].connectionName,
          possibleEndpoint1,
        )
        if (!possibleEndpointsByHash.has(pointHash)) {
          possibleEndpointsByHash.set(pointHash, possibleEndpoint1)
        }
        if (pointHashCounts.get(pointHash) === 1) {
          possibleEndpoints2.push(possibleEndpoint1)
        }
      }

      const candidateEndpoints =
        possibleEndpoints2.length > 0
          ? possibleEndpoints2
          : [...possibleEndpointsByHash.values()]

      if (candidateEndpoints.length === 0) {
        continue
      }

      let start: { x: number; y: number; z: number }
      let end: { x: number; y: number; z: number }

      if (candidateEndpoints.length >= 2) {
        const globalStart = {
          ...connection.pointsToConnect[0],
          z: mapLayerNameToZ(
            getConnectionPointLayer(connection.pointsToConnect[0]),
            params.layerCount,
          ),
        }
        const globalEnd = {
          ...connection.pointsToConnect[1],
          z: mapLayerNameToZ(
            getConnectionPointLayer(connection.pointsToConnect[1]),
            params.layerCount,
          ),
        }
        ;({ start, end } = this.selectIslandEndpoints({
          possibleEndpoints: candidateEndpoints,
          globalStart,
          globalEnd,
        }))

        if (
          distance(start, connection.pointsToConnect[1]) <
          distance(end, connection.pointsToConnect[0])
        ) {
          ;[start, end] = [end, start]
        }

        start = this.snapIslandEndpointToNearestTerminal({
          islandEndpoint: start,
          terminals: [globalStart, globalEnd],
        })
        end = this.snapIslandEndpointToNearestTerminal({
          islandEndpoint: end,
          terminals: [globalStart, globalEnd],
        })
      } else {
        start = {
          ...connection.pointsToConnect[0],
          z: mapLayerNameToZ(
            getConnectionPointLayer(connection.pointsToConnect[0]),
            params.layerCount,
          ),
        }
        end = {
          ...connection.pointsToConnect[1],
          z: mapLayerNameToZ(
            getConnectionPointLayer(connection.pointsToConnect[1]),
            params.layerCount,
          ),
        }
      }

      const selectedHdRoutes = this.selectRoutesAlongEndpointPath(
        hdRoutes[0].connectionName,
        hdRoutes,
        start,
        end,
      )

      this.unsolvedRoutes.push({
        connectionName: hdRoutes[0].connectionName,
        hdRoutes: selectedHdRoutes,
        start,
        end,
      })
    }

    const unsolvedRoutesByConnection = new Map<string, UnsolvedRoute3[]>()
    for (const unsolvedRoute of this.unsolvedRoutes) {
      const routes = unsolvedRoutesByConnection.get(
        unsolvedRoute.connectionName,
      )
      if (routes) {
        routes.push(unsolvedRoute)
      } else {
        unsolvedRoutesByConnection.set(unsolvedRoute.connectionName, [
          unsolvedRoute,
        ])
      }
    }

    this.unsolvedRoutes = Array.from(
      unsolvedRoutesByConnection.entries(),
    ).flatMap(([connectionName, unsolvedRoutes]) => {
      const hasDegenerateRoute = unsolvedRoutes.some((unsolvedRoute) =>
        unsolvedRoute.hdRoutes.some((hdRoute) => hdRoute.route.length < 2),
      )
      const hasStitchableGap =
        unsolvedRoutes.length > 1 &&
        this.hasStitchableGapBetweenUnsolvedRoutes(unsolvedRoutes)

      if (!hasDegenerateRoute && !hasStitchableGap) {
        return unsolvedRoutes
      }

      const connection = params.connections.find(
        (c) => c.name === connectionName,
      )
      if (!connection) return unsolvedRoutes

      const start = {
        ...connection.pointsToConnect[0],
        z: mapLayerNameToZ(
          getConnectionPointLayer(connection.pointsToConnect[0]),
          params.layerCount,
        ),
      }
      const end = {
        ...connection.pointsToConnect[1],
        z: mapLayerNameToZ(
          getConnectionPointLayer(connection.pointsToConnect[1]),
          params.layerCount,
        ),
      }

      const hdRoutes = unsolvedRoutes.flatMap(
        (unsolvedRoute) => unsolvedRoute.hdRoutes,
      )

      return [
        {
          connectionName,
          hdRoutes: this.selectRoutesAlongEndpointPath(
            connectionName,
            hdRoutes,
            start,
            end,
          ),
          start,
          end,
        },
      ]
    })

    this.MAX_ITERATIONS = 100e3
  }

  _step() {
    if (this.activeSolver) {
      this.activeSolver.step()
      if (this.activeSolver.solved) {
        if (this.activeSolver instanceof SingleHighDensityRouteStitchSolver3) {
          this.mergedHdRoutes.push(this.activeSolver.mergedHdRoute)
        }
        this.activeSolver = null
      } else if (this.activeSolver.failed) {
        this.failed = true
        this.error = this.activeSolver.error
      }
      return
    }

    const unsolvedRoute = this.unsolvedRoutes.pop()

    if (!unsolvedRoute) {
      this.solved = true
      return
    }

    this.activeSolver = new SingleHighDensityRouteStitchSolver3({
      connectionName: unsolvedRoute.connectionName,
      hdRoutes: unsolvedRoute.hdRoutes,
      start: unsolvedRoute.start,
      end: unsolvedRoute.end,
      colorMap: this.colorMap,
      defaultTraceThickness: this.defaultTraceThickness,
      defaultViaDiameter: this.defaultViaDiameter,
    })
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      points: [],
      lines: [],
      circles: [],
      rects: [],
      title: "Multiple High Density Route Stitch Solver 3",
    }

    if (this.activeSolver) {
      const activeSolverGraphics = this.activeSolver.visualize()
      if (activeSolverGraphics.points?.length) {
        graphics.points?.push(...activeSolverGraphics.points)
      }
      if (activeSolverGraphics.lines?.length) {
        graphics.lines?.push(...activeSolverGraphics.lines)
      }
      if (activeSolverGraphics.circles?.length) {
        graphics.circles?.push(...activeSolverGraphics.circles)
      }
      if (activeSolverGraphics.rects?.length) {
        if (!graphics.rects) graphics.rects = []
        graphics.rects.push(...activeSolverGraphics.rects)
      }
    }

    for (const [i, mergedRoute] of this.mergedHdRoutes.entries()) {
      const solvedColor =
        this.colorMap[mergedRoute.connectionName] ??
        `hsl(120, 100%, ${40 + ((i * 10) % 40)}%)`

      for (let j = 0; j < mergedRoute.route.length - 1; j++) {
        const p1 = mergedRoute.route[j]
        const p2 = mergedRoute.route[j + 1]
        const segmentColor =
          p1.z !== 0 ? safeTransparentize(solvedColor, 0.5) : solvedColor

        graphics.lines?.push({
          points: [
            { x: p1.x, y: p1.y },
            { x: p2.x, y: p2.y },
          ],
          strokeColor: segmentColor,
          strokeWidth: mergedRoute.traceThickness,
        })
      }

      for (const point of mergedRoute.route) {
        const pointColor =
          point.z !== 0 ? safeTransparentize(solvedColor, 0.5) : solvedColor
        graphics.points?.push({
          x: point.x,
          y: point.y,
          color: pointColor,
        })
      }

      for (const via of mergedRoute.vias) {
        graphics.circles?.push({
          center: { x: via.x, y: via.y },
          radius: mergedRoute.viaDiameter / 2,
          fill: solvedColor,
        })
      }

      if (mergedRoute.jumpers && mergedRoute.jumpers.length > 0) {
        const jumperGraphics = getJumpersGraphics(mergedRoute.jumpers, {
          color: solvedColor,
          label: mergedRoute.connectionName,
        })
        graphics.rects!.push(...(jumperGraphics.rects ?? []))
        graphics.lines!.push(...(jumperGraphics.lines ?? []))
      }
    }

    return graphics
  }
}
