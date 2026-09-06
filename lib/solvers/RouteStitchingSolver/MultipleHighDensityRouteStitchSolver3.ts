import { distance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "connectivity-map"
import { GraphicsObject } from "graphics-debug"
import { SimpleRouteConnection } from "lib/types"
import { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import { BaseSolver } from "../BaseSolver"
import { safeTransparentize } from "../colors"
import { RouteStitchClearanceValidator } from "./route-stitch-clearance-validator"
import { SingleHighDensityRouteStitchSolver3 } from "./SingleHighDensityRouteStitchSolver3"
import { getRouteStitchEndpoint } from "./getRouteStitchEndpoint"
import { type StitchTerminal, getStitchTerminal } from "./getStitchTerminal"
import {
  EndpointClusterIndex,
  type OrderedRouteStitchEntry,
  type RouteStitchPathSelection,
  hasStitchableGapBetweenUnsolvedRoutes,
  selectIslandEndpoints,
  selectRoutesAlongEndpointPath,
  snapIslandEndpointToNearestTerminal,
} from "./routeStitchingEndpointHelpers"
import {
  compareRoutes,
  MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
} from "./routeStitchingShared"

export type UnsolvedRoute3 = {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  orderedRoutePath?: OrderedRouteStitchEntry[]
  start: StitchTerminal
  end: StitchTerminal
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
  private clearanceValidator: RouteStitchClearanceValidator

  private canStitchBetweenTerminals(params: {
    connectionName: string
    hdRoutes: HighDensityIntraNodeRoute[]
    start: StitchTerminal
    end: StitchTerminal
    orderedRoutePath?: OrderedRouteStitchEntry[]
  }): boolean {
    const stitchSolver = new SingleHighDensityRouteStitchSolver3({
      connectionName: params.connectionName,
      hdRoutes: params.hdRoutes,
      orderedRoutePath: params.orderedRoutePath,
      start: params.start,
      end: params.end,
      colorMap: this.colorMap,
      defaultTraceThickness: this.defaultTraceThickness,
      defaultViaDiameter: this.defaultViaDiameter,
      allowedLayerTransitionPointKeys: this.allowedLayerTransitionPointKeys,
      preserveTerminalPcbPortIds: this.preserveTerminalPcbPortIds,
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

    if (stitchSolver.failed || !stitchSolver.solved) return false

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

  private getSharedRootPathRoutes(params: {
    connectionName: string
    rootConnectionName?: string
    hdRoutes: HighDensityIntraNodeRoute[]
    allHdRoutes: HighDensityIntraNodeRoute[]
    start: StitchTerminal
    end: StitchTerminal
  }): RouteStitchPathSelection | null {
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

    const selection = selectRoutesAlongEndpointPath({
      connectionName: params.connectionName,
      hdRoutes: sameRootRoutes,
      start: params.start,
      end: params.end,
      endpointIndex: this.endpointIndex,
      canStitchBetweenTerminals: (selection) =>
        this.canStitchBetweenTerminals(selection),
    })
    if (!selection) return null
    const pathRoutes = selection.hdRoutes

    const includesSharedRootBridge = pathRoutes.some(
      (route) => !currentRouteSet.has(route),
    )
    // A shared-root selection must actually add a bridge to this island.
    if (!includesSharedRootBridge) return null

    return selection
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
    this.endpointIndex = new EndpointClusterIndex(
      params.preferSameLayerTerminalEndpoints,
    )
    this.colorMap = params.colorMap ?? {}
    this.allowedLayerTransitionPointKeys =
      params.allowedLayerTransitionPointKeys
    this.preserveTerminalPcbPortIds = params.preserveTerminalPcbPortIds ?? false

    const canonicalHdRoutes = [...params.hdRoutes].sort(compareRoutes)
    this.clearanceValidator = new RouteStitchClearanceValidator({
      hdRoutes: canonicalHdRoutes,
    })

    const firstRoute = canonicalHdRoutes[0]
    this.defaultTraceThickness = firstRoute?.traceThickness ?? 0.15
    this.defaultViaDiameter =
      firstRoute?.viaDiameter ?? params.defaultViaDiameter ?? 0.3

    const routeIslandConnectivityMap = new ConnectivityMap({})
    const routeIslandConnections: Array<string[]> = []
    const pointHashCounts = new Map<string, number>()

    for (let i = 0; i < canonicalHdRoutes.length; i++) {
      const hdRoute = canonicalHdRoutes[i]
      const start = getRouteStitchEndpoint(hdRoute, "first")
      const end = getRouteStitchEndpoint(hdRoute, "last")
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
        getRouteStitchEndpoint(r, "first"),
        getRouteStitchEndpoint(r, "last"),
      ])

      const possibleEndpointsByHash = new Map<string, StitchTerminal>()
      const possibleEndpoints2: StitchTerminal[] = []
      for (const possibleEndpoint1 of possibleEndpoints1) {
        const pointHash = this.endpointIndex.getEndpointKey(
          hdRoutes[0].connectionName,
          possibleEndpoint1,
        )
        const existingEndpoint = possibleEndpointsByHash.get(pointHash)
        if (
          existingEndpoint?.pcb_port_id &&
          possibleEndpoint1.pcb_port_id &&
          existingEndpoint.pcb_port_id !== possibleEndpoint1.pcb_port_id
        ) {
          throw new Error(
            `Route stitching found conflicting PCB terminal claims "${existingEndpoint.pcb_port_id}" and "${possibleEndpoint1.pcb_port_id}" in one endpoint cluster`,
          )
        }
        if (
          !existingEndpoint ||
          (!existingEndpoint.pcb_port_id && possibleEndpoint1.pcb_port_id)
        ) {
          possibleEndpointsByHash.set(pointHash, possibleEndpoint1)
        }
      }
      for (const [pointHash, endpoint] of possibleEndpointsByHash) {
        if (endpoint.pcb_port_id || pointHashCounts.get(pointHash) === 1) {
          possibleEndpoints2.push(endpoint)
        }
      }

      const candidateEndpoints =
        possibleEndpoints2.length > 0
          ? possibleEndpoints2
          : [...possibleEndpointsByHash.values()]

      if (candidateEndpoints.length === 0) {
        continue
      }

      let start: StitchTerminal
      let end: StitchTerminal

      if (candidateEndpoints.length >= 2) {
        const globalStart = getStitchTerminal(
          connection.pointsToConnect[0],
          params.layerCount,
        )
        const globalEnd = getStitchTerminal(
          connection.pointsToConnect[1],
          params.layerCount,
        )
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
        start = getStitchTerminal(
          connection.pointsToConnect[0],
          params.layerCount,
        )
        end = getStitchTerminal(
          connection.pointsToConnect[1],
          params.layerCount,
        )
      }

      // Keep provisional islands intact until their connection-level merge
      // is known; a nearby spur is not itself a required terminal path.
      this.unsolvedRoutes.push({
        connectionName: hdRoutes[0].connectionName,
        hdRoutes,
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

      const start = getStitchTerminal(
        connection.pointsToConnect[0],
        params.layerCount,
      )
      const end = getStitchTerminal(
        connection.pointsToConnect[1],
        params.layerCount,
      )

      const hdRoutes = unsolvedRoutes.flatMap(
        (unsolvedRoute) => unsolvedRoute.hdRoutes,
      )
      const sharedRootPathRoutes =
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

      if (!hasDegenerateRoute && !hasStitchableGap && !sharedRootPathRoutes) {
        return unsolvedRoutes.map((route): UnsolvedRoute3 => {
          const selection = selectRoutesAlongEndpointPath({
            ...route,
            endpointIndex: this.endpointIndex,
            canStitchBetweenTerminals: (candidate) =>
              this.canStitchBetweenTerminals(candidate),
          })
          if (!selection) {
            throw new Error(
              `No endpoint path connects the final route island for "${connectionName}"`,
            )
          }
          return { ...route, ...selection }
        })
      }

      const selection =
        sharedRootPathRoutes ??
        selectRoutesAlongEndpointPath({
          connectionName,
          hdRoutes,
          start,
          end,
          endpointIndex: this.endpointIndex,
          canStitchBetweenTerminals: (candidate) =>
            this.canStitchBetweenTerminals(candidate),
        })
      if (!selection) {
        throw new Error(
          `No endpoint path connects the merged route islands for "${connectionName}"`,
        )
      }
      return [{ connectionName, ...selection, start, end }]
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
      this.solved = true
      return
    }

    this.activeSolver = new SingleHighDensityRouteStitchSolver3({
      connectionName: unsolvedRoute.connectionName,
      hdRoutes: unsolvedRoute.hdRoutes,
      orderedRoutePath: unsolvedRoute.orderedRoutePath,
      start: unsolvedRoute.start,
      end: unsolvedRoute.end,
      colorMap: this.colorMap,
      defaultTraceThickness: this.defaultTraceThickness,
      defaultViaDiameter: this.defaultViaDiameter,
      allowedLayerTransitionPointKeys: this.allowedLayerTransitionPointKeys,
      preserveTerminalPcbPortIds: this.preserveTerminalPcbPortIds,
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
