import { distance, type Point3 } from "@tscircuit/math-utils"
import { ConnectivityMap } from "connectivity-map"
import { mergeGraphics, type GraphicsObject } from "graphics-debug"
import type { Obstacle, SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getConnectionPointLayer } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { BaseSolver } from "../BaseSolver"
import {
  type FindValidStitchPath,
  type IsValidStitchSegment,
  type IsTerminalCoveredByTrace,
  SingleHighDensityRouteStitchSolver3,
} from "./SingleHighDensityRouteStitchSolver3"
import { createCachedStitchGapValidator } from "./create-cached-stitch-gap-validator"
import { createStitchSegmentRouter } from "./create-stitch-segment-validator"
import {
  EndpointClusterIndex,
  hasStitchableGapBetweenUnsolvedRoutes,
  selectIslandEndpoints,
  selectRoutesAlongEndpointPath,
  snapIslandEndpointToNearestTerminal,
  type EndpointKey,
  type EndpointPathSelection,
  type IsValidStitchGap,
  type StitchRepairPolicy,
} from "./routeStitchingEndpointHelpers"
import {
  compareRoutes,
  MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
} from "./routeStitchingShared"
import {
  visualizeSingleHighDensityRouteStitchSolver3,
  type StitchVisualizationInput,
} from "./visualize-single-high-density-route-stitch-solver3"

export type UnsolvedRoute3 = {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: Point3
  end: Point3
  stitchRepairPolicy: StitchRepairPolicy
}

type ConnectionName = string

const getDiagonalLayerTransition = (route: HighDensityIntraNodeRoute) => {
  for (let pointIndex = 1; pointIndex < route.route.length; pointIndex += 1) {
    const previousPoint = route.route[pointIndex - 1]!
    const point = route.route[pointIndex]!
    if (
      previousPoint.z !== point.z &&
      (previousPoint.x !== point.x || previousPoint.y !== point.y)
    ) {
      return { pointIndex, previousPoint, point }
    }
  }
  return undefined
}

export class MultipleHighDensityRouteStitchSolver3 extends BaseSolver {
  override getSolverName(): string {
    return "MultipleHighDensityRouteStitchSolver3"
  }

  unsolvedRoutes: UnsolvedRoute3[]
  activeSolver: SingleHighDensityRouteStitchSolver3 | null = null
  mergedHdRoutes: HighDensityIntraNodeRoute[] = []
  private completedStitchAttempts: StitchVisualizationInput[] = []
  colorMap: Record<string, string> = {}
  obstacles: Obstacle[]
  defaultTraceThickness: number
  defaultViaDiameter: number
  allowedLayerTransitionPointKeys?: Set<string>
  preserveTerminalPcbPortIds: boolean
  stitchRepairPolicy: StitchRepairPolicy
  private isValidStitchSegment?: IsValidStitchSegment
  private findValidStitchPath?: FindValidStitchPath
  private isTerminalCoveredByTrace?: IsTerminalCoveredByTrace
  private isValidStitchGap!: IsValidStitchGap
  private endpointIndex = new EndpointClusterIndex()

  private canStitchBetweenTerminals(
    params: {
      connectionName: string
      hdRoutes: HighDensityIntraNodeRoute[]
      start: Point3
      end: Point3
    },
    stitchRepairPolicy: StitchRepairPolicy,
  ): boolean {
    const stitchSolver = new SingleHighDensityRouteStitchSolver3({
      connectionName: params.connectionName,
      hdRoutes: params.hdRoutes,
      start: params.start,
      end: params.end,
      colorMap: this.colorMap,
      defaultTraceThickness: this.defaultTraceThickness,
      defaultViaDiameter: this.defaultViaDiameter,
      allowedLayerTransitionPointKeys: this.allowedLayerTransitionPointKeys,
      preserveTerminalPcbPortIds: this.preserveTerminalPcbPortIds,
      isValidStitchSegment: this.isValidStitchSegment,
      isTerminalCoveredByTrace: this.isTerminalCoveredByTrace,
      stitchRepairPolicy,
      obstacles: this.obstacles,
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

    const directDistance =
      distance(routeStart, params.start) + distance(routeEnd, params.end)
    const swappedDistance =
      distance(routeStart, params.end) + distance(routeEnd, params.start)

    return (
      Math.min(directDistance, swappedDistance) <=
      MAX_TERMINAL_STITCH_GAP_DISTANCE_3
    )
  }

  private getStitchRepairPolicyBetweenTerminals(
    selection: {
      connectionName: string
      hdRoutes: HighDensityIntraNodeRoute[]
      start: Point3
      end: Point3
    },
    allowedRepairPolicy: StitchRepairPolicy,
  ): StitchRepairPolicy | null {
    if (this.canStitchBetweenTerminals(selection, "validated_only")) {
      return "validated_only"
    }
    return allowedRepairPolicy === "allow_drc_repair"
      ? "allow_drc_repair"
      : null
  }

  private getSharedRootPathRoutes(params: {
    connectionName: string
    rootConnectionName?: string
    hdRoutes: HighDensityIntraNodeRoute[]
    allHdRoutes: HighDensityIntraNodeRoute[]
    start: Point3
    end: Point3
  }): EndpointPathSelection | null {
    const rootConnectionName = params.rootConnectionName
    if (!rootConnectionName) return null

    const currentRouteSet = new Set(params.hdRoutes)
    const sameRootRoutes = params.allHdRoutes.filter(
      (route) =>
        (route.rootConnectionName ?? route.connectionName) ===
        rootConnectionName,
    )

    if (sameRootRoutes.every((route) => currentRouteSet.has(route))) {
      return null
    }

    const pathSelection = selectRoutesAlongEndpointPath({
      connectionName: params.connectionName,
      hdRoutes: sameRootRoutes,
      start: params.start,
      end: params.end,
      endpointIndex: this.endpointIndex,
      getStitchRepairPolicyBetweenTerminals: (selection) =>
        this.getStitchRepairPolicyBetweenTerminals(selection, "validated_only"),
      isValidStitchGap: (gap) => this.isValidStitchGap(gap),
      stitchRepairPolicy: "validated_only",
    })
    const pathRoutes = pathSelection.hdRoutes

    const includesSharedRootBridge = pathRoutes.some(
      (route) => !currentRouteSet.has(route),
    )
    // The endpoint path helper returns all candidate routes as a fallback when
    // no path is found, so only accept a strict same-root subset.
    if (!includesSharedRootBridge || pathRoutes.length >= sameRootRoutes.length)
      return null

    return pathSelection
  }

  constructor(params: {
    connections: SimpleRouteConnection[]
    hdRoutes: HighDensityIntraNodeRoute[]
    colorMap?: Record<string, string>
    layerCount: number
    defaultViaDiameter?: number
    allowedLayerTransitionPointKeys?: Set<string>
    preserveTerminalPcbPortIds?: boolean
    obstacles?: Obstacle[]
    connMap?: { areIdsConnected: (a: string, b: string) => boolean }
    minTraceToPadEdgeClearance?: number
    stitchRepairPolicy?: StitchRepairPolicy
  }) {
    super()
    this.colorMap = params.colorMap ?? {}
    this.obstacles = params.obstacles ?? []
    this.allowedLayerTransitionPointKeys =
      params.allowedLayerTransitionPointKeys
    this.preserveTerminalPcbPortIds = params.preserveTerminalPcbPortIds ?? false
    this.stitchRepairPolicy = params.stitchRepairPolicy ?? "validated_only"

    const canonicalHdRoutes = [...params.hdRoutes].sort(compareRoutes)

    for (const route of canonicalHdRoutes) {
      const diagonalTransition = getDiagonalLayerTransition(route)
      if (!diagonalTransition) continue
      throw new Error(
        `Route stitch input "${route.connectionName}" has a diagonal layer transition before point ${diagonalTransition.pointIndex}: ${JSON.stringify(diagonalTransition.previousPoint)} -> ${JSON.stringify(diagonalTransition.point)}`,
      )
    }

    if (params.obstacles || params.connMap) {
      const stitchSegmentRouter = createStitchSegmentRouter({
        hdRoutes: canonicalHdRoutes,
        obstacles: params.obstacles ?? [],
        layerCount: params.layerCount,
        connMap: params.connMap,
        minClearance: params.minTraceToPadEdgeClearance ?? 0.1,
      })
      this.isValidStitchSegment = stitchSegmentRouter.isValidSegment
      this.findValidStitchPath = stitchSegmentRouter.findValidPath
      this.isTerminalCoveredByTrace =
        stitchSegmentRouter.isTerminalCoveredByTrace
    }

    const firstRoute = canonicalHdRoutes[0]
    this.defaultTraceThickness = firstRoute?.traceThickness ?? 0.15
    this.defaultViaDiameter =
      firstRoute?.viaDiameter ?? params.defaultViaDiameter ?? 0.3
    this.isValidStitchGap = createCachedStitchGapValidator({
      traceThickness: this.defaultTraceThickness,
      isValidStitchSegment: this.isValidStitchSegment,
      findValidStitchPath: this.findValidStitchPath,
    })

    const routeIslandConnectivityMap = new ConnectivityMap({})
    const routeIslandConnections: Array<string[]> = []
    const pointHashCounts = new Map<EndpointKey, number>()

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
        EndpointKey,
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

        start = snapIslandEndpointToNearestTerminal({
          islandEndpoint: start,
          terminals: [globalStart, globalEnd],
        })
        end = snapIslandEndpointToNearestTerminal({
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

      const pathSelection = selectRoutesAlongEndpointPath({
        connectionName: hdRoutes[0].connectionName,
        hdRoutes,
        start,
        end,
        endpointIndex: this.endpointIndex,
        getStitchRepairPolicyBetweenTerminals: (selection) =>
          this.getStitchRepairPolicyBetweenTerminals(
            selection,
            this.stitchRepairPolicy,
          ),
        isValidStitchGap: (gap) => this.isValidStitchGap(gap),
        stitchRepairPolicy: this.stitchRepairPolicy,
      })

      this.unsolvedRoutes.push({
        connectionName: hdRoutes[0].connectionName,
        hdRoutes: pathSelection.hdRoutes,
        start,
        end,
        stitchRepairPolicy: pathSelection.stitchRepairPolicy,
      })
    }

    const unsolvedRoutesByConnection = new Map<
      ConnectionName,
      UnsolvedRoute3[]
    >()
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
      const connection = params.connections.find(
        (c) => c.name === connectionName,
      )
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
      const sharedRootPathSelection =
        unsolvedRoutes.length > 1
          ? this.getSharedRootPathRoutes({
              connectionName,
              rootConnectionName:
                connection.__rootConnectionNames?.[0] ??
                hdRoutes[0]?.rootConnectionName,
              hdRoutes,
              allHdRoutes: canonicalHdRoutes,
              start,
              end,
            })
          : null

      if (
        !hasDegenerateRoute &&
        !hasStitchableGap &&
        !sharedRootPathSelection
      ) {
        return unsolvedRoutes
      }

      const pathSelection = sharedRootPathSelection
        ? sharedRootPathSelection
        : selectRoutesAlongEndpointPath({
            connectionName,
            hdRoutes,
            start,
            end,
            endpointIndex: this.endpointIndex,
            getStitchRepairPolicyBetweenTerminals: (selection) =>
              this.getStitchRepairPolicyBetweenTerminals(
                selection,
                this.stitchRepairPolicy,
              ),
            isValidStitchGap: (gap) => this.isValidStitchGap(gap),
            stitchRepairPolicy: this.stitchRepairPolicy,
          })

      return [
        {
          connectionName,
          hdRoutes: pathSelection.hdRoutes,
          start,
          end,
          stitchRepairPolicy: pathSelection.stitchRepairPolicy,
        },
      ]
    })

    this.MAX_ITERATIONS = 100e3
  }

  _step(): void {
    if (this.activeSolver) {
      this.activeSolver.step()
      if (this.activeSolver.solved) {
        if (this.activeSolver instanceof SingleHighDensityRouteStitchSolver3) {
          const diagonalTransition = getDiagonalLayerTransition(
            this.activeSolver.mergedHdRoute,
          )
          if (diagonalTransition) {
            this.failed = true
            this.error = `Route stitch output "${this.activeSolver.mergedHdRoute.connectionName}" created a diagonal layer transition before point ${diagonalTransition.pointIndex}: ${JSON.stringify(diagonalTransition.previousPoint)} -> ${JSON.stringify(diagonalTransition.point)}`
            return
          }
          this.mergedHdRoutes.push(this.activeSolver.mergedHdRoute)
          this.completedStitchAttempts.push({
            inputHdRoutes: this.activeSolver.inputHdRoutes,
            mergedHdRoute: this.activeSolver.mergedHdRoute,
            remainingHdRoutes: [],
            start: this.activeSolver.start,
            end: this.activeSolver.end,
            colorMap: this.colorMap,
            obstacles: this.obstacles,
            stitchRepairPolicy: this.activeSolver.stitchRepairPolicy,
            isValidStitchSegment: this.isValidStitchSegment,
          })
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
      allowedLayerTransitionPointKeys: this.allowedLayerTransitionPointKeys,
      preserveTerminalPcbPortIds: this.preserveTerminalPcbPortIds,
      isValidStitchSegment: this.isValidStitchSegment,
      findValidStitchPath: this.findValidStitchPath,
      isTerminalCoveredByTrace: this.isTerminalCoveredByTrace,
      stitchRepairPolicy: unsolvedRoute.stitchRepairPolicy,
      obstacles: this.obstacles,
    })
  }

  visualize(): GraphicsObject {
    let graphics: GraphicsObject = {
      points: [],
      lines: [],
      circles: [],
      rects: [],
      title: "Multiple High Density Route Stitch Solver 3",
    }

    for (const completedAttempt of this.completedStitchAttempts) {
      graphics = mergeGraphics(
        graphics,
        visualizeSingleHighDensityRouteStitchSolver3(completedAttempt),
      )
    }

    if (this.activeSolver) {
      graphics = mergeGraphics(graphics, this.activeSolver.visualize())
    }

    return graphics
  }
}
