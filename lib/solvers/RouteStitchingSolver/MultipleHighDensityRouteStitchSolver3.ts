import { distance, type Point3 } from "@tscircuit/math-utils"
import { ConnectivityMap } from "connectivity-map"
import { GraphicsObject } from "graphics-debug"
import type { RootConnectionName, SimpleRouteConnection } from "lib/types"
import { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getConnectionPointLayer } from "lib/types/srj-types"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { BaseSolver } from "../BaseSolver"
import { safeTransparentize } from "../colors"
import { RouteStitchClearanceValidator } from "./route-stitch-clearance-validator"
import { SingleHighDensityRouteStitchSolver3 } from "./SingleHighDensityRouteStitchSolver3"
import {
  EndpointClusterIndex,
  RouteEndpointPathIndex,
  hasStitchableGapBetweenUnsolvedRoutes,
  selectIslandEndpoints,
  selectRoutesAlongEndpointPath,
  snapIslandEndpointsToDistinctTerminals,
} from "./routeStitchingEndpointHelpers"
import {
  compareRoutes,
  MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
} from "./routeStitchingShared"

export type UnsolvedRoute3 = {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: Point3
  end: Point3
}

type ConnectionName = string
type PcbPortId = string
type RouteIslandId = string
type RouteIslandNetName = string
type EndpointHash = string

const getRootConnectionNames = (
  connection: SimpleRouteConnection,
): RootConnectionName[] => {
  const rootConnectionNames = new Set(connection.__rootConnectionNames ?? [])
  if (connection.rootConnectionName) {
    rootConnectionNames.add(connection.rootConnectionName)
  }
  if (rootConnectionNames.size === 0) rootConnectionNames.add(connection.name)
  return [...rootConnectionNames]
}

const getValidPcbPortIdsByConnectionName = (
  connections: SimpleRouteConnection[],
): Map<ConnectionName, ReadonlySet<PcbPortId>> => {
  const pcbPortIdsByRootConnectionName = new Map<
    RootConnectionName,
    Set<PcbPortId>
  >()

  for (const connection of connections) {
    for (const rootConnectionName of getRootConnectionNames(connection)) {
      const pcbPortIds =
        pcbPortIdsByRootConnectionName.get(rootConnectionName) ?? new Set()
      for (const point of connection.pointsToConnect) {
        if (point.pcb_port_id) pcbPortIds.add(point.pcb_port_id)
      }
      pcbPortIdsByRootConnectionName.set(rootConnectionName, pcbPortIds)
    }
  }

  const validPcbPortIdsByConnectionName = new Map<
    ConnectionName,
    ReadonlySet<PcbPortId>
  >()
  for (const connection of connections) {
    const validPcbPortIds = new Set<PcbPortId>()
    for (const rootConnectionName of getRootConnectionNames(connection)) {
      for (const pcbPortId of pcbPortIdsByRootConnectionName.get(
        rootConnectionName,
      ) ?? []) {
        validPcbPortIds.add(pcbPortId)
      }
    }
    validPcbPortIdsByConnectionName.set(connection.name, validPcbPortIds)
  }

  return validPcbPortIdsByConnectionName
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
  allowedLayerTransitionPointKeys?: Set<string>
  preserveTerminalPcbPortIds: boolean
  private endpointIndex: EndpointClusterIndex
  private readonly preferSameLayerTerminalEndpoints: boolean
  private sharedRootPathIndexes = new Map<
    RootConnectionName,
    RouteEndpointPathIndex
  >()
  private clearanceValidator: RouteStitchClearanceValidator
  private validPcbPortIdsByConnectionName: Map<
    ConnectionName,
    ReadonlySet<PcbPortId>
  >

  private canStitchBetweenTerminals(params: {
    connectionName: string
    hdRoutes: HighDensityIntraNodeRoute[]
    start: Point3
    end: Point3
  }) {
    const stitchSolver = new SingleHighDensityRouteStitchSolver3({
      connectionName: params.connectionName,
      hdRoutes: params.hdRoutes,
      start: params.start,
      end: params.end,
      colorMap: this.colorMap,
      defaultTraceThickness: this.defaultTraceThickness,
      defaultViaDiameter: this.defaultViaDiameter,
      allowedLayerTransitionPointKeys: this.allowedLayerTransitionPointKeys,
      preserveTerminalPcbPortIds: false,
      isStitchSegmentClear: (stitchSegment) =>
        this.clearanceValidator.isSegmentClear(stitchSegment),
      stitchClearanceMode: "require_clear",
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

    return (
      routeStart.z === stitchSolver.start.z &&
      routeEnd.z === stitchSolver.end.z &&
      distance(routeStart, stitchSolver.start) +
        distance(routeEnd, stitchSolver.end) <=
        MAX_TERMINAL_STITCH_GAP_DISTANCE_3
    )
  }

  private getSharedRootPathRoutes(params: {
    connectionName: string
    rootConnectionName: RootConnectionName
    hdRoutes: HighDensityIntraNodeRoute[]
    sameRootRoutes: HighDensityIntraNodeRoute[]
    start: Point3
    end: Point3
  }): HighDensityIntraNodeRoute[] | null {
    const currentRouteSet = new Set(params.hdRoutes)

    if (params.sameRootRoutes.every((route) => currentRouteSet.has(route))) {
      return null
    }

    let sharedRootPathIndex = this.sharedRootPathIndexes.get(
      params.rootConnectionName,
    )
    if (!sharedRootPathIndex) {
      sharedRootPathIndex = new RouteEndpointPathIndex({
        endpointGroupName: `shared_root_${params.rootConnectionName}`,
        hdRoutes: params.sameRootRoutes,
        endpointIndex: new EndpointClusterIndex(
          this.preferSameLayerTerminalEndpoints,
        ),
      })
      this.sharedRootPathIndexes.set(
        params.rootConnectionName,
        sharedRootPathIndex,
      )
    }

    const pathRoutes = sharedRootPathIndex.selectRoutes({
      connectionName: params.connectionName,
      start: params.start,
      end: params.end,
      canStitchBetweenTerminals: (selection) =>
        this.canStitchBetweenTerminals(selection),
    })

    const includesSharedRootBridge = pathRoutes.some(
      (route) => !currentRouteSet.has(route),
    )
    // The endpoint path helper returns all candidate routes as a fallback when
    // no path is found, so only accept a strict same-root subset.
    if (
      !includesSharedRootBridge ||
      pathRoutes.length >= params.sameRootRoutes.length
    )
      return null

    return pathRoutes
  }

  constructor(params: {
    connections: SimpleRouteConnection[]
    hdRoutes: HighDensityIntraNodeRoute[]
    colorMap?: Record<string, string>
    layerCount: number
    defaultViaDiameter?: number
    allowedLayerTransitionPointKeys?: Set<string>
    preserveTerminalPcbPortIds?: boolean
    preferSameLayerTerminalEndpoints?: boolean
  }) {
    super()
    this.preferSameLayerTerminalEndpoints =
      params.preferSameLayerTerminalEndpoints ?? false
    this.endpointIndex = new EndpointClusterIndex(
      this.preferSameLayerTerminalEndpoints,
    )
    this.colorMap = params.colorMap ?? {}
    this.allowedLayerTransitionPointKeys =
      params.allowedLayerTransitionPointKeys
    this.preserveTerminalPcbPortIds = params.preserveTerminalPcbPortIds ?? false
    this.validPcbPortIdsByConnectionName = getValidPcbPortIdsByConnectionName(
      params.connections,
    )

    const canonicalHdRoutes = [...params.hdRoutes].sort(compareRoutes)
    const connectionsByName = new Map<ConnectionName, SimpleRouteConnection>(
      params.connections.map((connection) => [connection.name, connection]),
    )
    const hdRoutesByRootConnectionName = new Map<
      RootConnectionName,
      HighDensityIntraNodeRoute[]
    >()
    for (const hdRoute of canonicalHdRoutes) {
      const rootConnectionName =
        hdRoute.rootConnectionName ?? hdRoute.connectionName
      const rootHdRoutes =
        hdRoutesByRootConnectionName.get(rootConnectionName) ?? []
      rootHdRoutes.push(hdRoute)
      hdRoutesByRootConnectionName.set(rootConnectionName, rootHdRoutes)
    }
    this.clearanceValidator = new RouteStitchClearanceValidator({
      hdRoutes: canonicalHdRoutes,
    })

    const firstRoute = canonicalHdRoutes[0]
    this.defaultTraceThickness = firstRoute?.traceThickness ?? 0.15
    this.defaultViaDiameter =
      firstRoute?.viaDiameter ?? params.defaultViaDiameter ?? 0.3

    const routeIslandConnectivityMap = new ConnectivityMap({})
    const routeIslandConnections: Array<string[]> = []
    const pointHashCounts = new Map<EndpointHash, number>()

    for (let i = 0; i < canonicalHdRoutes.length; i++) {
      const hdRoute = canonicalHdRoutes[i]
      const start = hdRoute.route[0]
      const end = hdRoute.route[hdRoute.route.length - 1]
      routeIslandConnections.push([
        `route_island_${i}`,
        this.endpointIndex.getEndpointKey(hdRoute.connectionName, start),
        this.endpointIndex.getEndpointKey(hdRoute.connectionName, end),
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

    const routeIndexesByNetName = new Map<RouteIslandNetName, number[]>()
    for (
      let routeIndex = 0;
      routeIndex < canonicalHdRoutes.length;
      routeIndex++
    ) {
      const routeIslandId: RouteIslandId = `route_island_${routeIndex}`
      const netName = routeIslandConnectivityMap.idToNetMap[routeIslandId]
      if (!netName) {
        throw new Error(
          `Route stitching invariant violated: no connectivity net for "${routeIslandId}"`,
        )
      }
      const routeIndexes = routeIndexesByNetName.get(netName) ?? []
      routeIndexes.push(routeIndex)
      routeIndexesByNetName.set(netName, routeIndexes)
    }

    for (const routeIndexes of routeIndexesByNetName.values()) {
      const hdRoutes = routeIndexes.map(
        (routeIndex) => canonicalHdRoutes[routeIndex]!,
      )
      if (hdRoutes.length === 0) continue

      const connection = connectionsByName.get(hdRoutes[0].connectionName)
      if (!connection) {
        throw new Error(
          `Route stitching invariant violated: no connection named "${hdRoutes[0].connectionName}"`,
        )
      }

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
        const pointHash = this.endpointIndex.getEndpointKey(
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

      let start: Point3
      let end: Point3

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
        ;({ start, end } = selectIslandEndpoints({
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
        ;({ start, end } = snapIslandEndpointsToDistinctTerminals({
          start,
          end,
          globalStart,
          globalEnd,
        }))
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

      const selectedHdRoutes = selectRoutesAlongEndpointPath({
        connectionName: hdRoutes[0].connectionName,
        hdRoutes,
        start,
        end,
        endpointIndex: this.endpointIndex,
        canStitchBetweenTerminals: (selection) =>
          this.canStitchBetweenTerminals(selection),
      })

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
      const connection = connectionsByName.get(connectionName)
      const hasDegenerateRoute = unsolvedRoutes.some((unsolvedRoute) =>
        unsolvedRoute.hdRoutes.some((hdRoute) => hdRoute.route.length < 2),
      )
      const hasStitchableGap =
        unsolvedRoutes.length > 1 &&
        hasStitchableGapBetweenUnsolvedRoutes(unsolvedRoutes)

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
      const rootConnectionName =
        connection.__rootConnectionNames?.[0] ??
        hdRoutes[0]?.rootConnectionName ??
        connectionName
      const sharedRootPathRoutes =
        unsolvedRoutes.length > 1
          ? this.getSharedRootPathRoutes({
              connectionName,
              rootConnectionName,
              sameRootRoutes:
                hdRoutesByRootConnectionName.get(rootConnectionName) ??
                hdRoutes,
              hdRoutes,
              start,
              end,
            })
          : null

      if (!hasDegenerateRoute && !hasStitchableGap && !sharedRootPathRoutes) {
        return unsolvedRoutes
      }

      return [
        {
          connectionName,
          hdRoutes:
            sharedRootPathRoutes ??
            selectRoutesAlongEndpointPath({
              connectionName,
              hdRoutes,
              start,
              end,
              endpointIndex: this.endpointIndex,
              canStitchBetweenTerminals: (selection) =>
                this.canStitchBetweenTerminals(selection),
            }),
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
          this.clearanceValidator.addRoute(this.activeSolver.mergedHdRoute)
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
      const connectionNamesWithCompleteTerminalRoutes =
        new Set<ConnectionName>()
      for (const route of this.mergedHdRoutes) {
        if (route.startPcbPortId && route.endPcbPortId) {
          connectionNamesWithCompleteTerminalRoutes.add(route.connectionName)
        }
      }
      this.mergedHdRoutes = this.mergedHdRoutes.filter(
        (route) =>
          !connectionNamesWithCompleteTerminalRoutes.has(
            route.connectionName,
          ) || Boolean(route.startPcbPortId && route.endPcbPortId),
      )
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
      allowedLayerTransitionPointKeys: this.allowedLayerTransitionPointKeys,
      preserveTerminalPcbPortIds: this.preserveTerminalPcbPortIds,
      validPcbPortIds: this.validPcbPortIdsByConnectionName.get(
        unsolvedRoute.connectionName,
      ),
      isStitchSegmentClear: (stitchSegment) =>
        this.clearanceValidator.isSegmentClear(stitchSegment),
      stitchClearanceMode: "prefer_clear",
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
