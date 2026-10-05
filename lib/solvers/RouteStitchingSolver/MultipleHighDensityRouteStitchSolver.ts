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
import { SingleHighDensityRouteStitchSolver } from "./SingleHighDensityRouteStitchSolver"

export type UnsolvedRoute = {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: { x: number; y: number; z: number }
  end: { x: number; y: number; z: number }
}

const roundedPointHash = (p: { x: number; y: number; z: number }) =>
  `${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.z * 100)}`

const getEndpointHashes = (route: HighDensityIntraNodeRoute) => ({
  startHash: roundedPointHash(route.route[0]!),
  endHash: roundedPointHash(route.route[route.route.length - 1]!),
})

export class MultipleHighDensityRouteStitchSolver extends BaseSolver {
  override getSolverName(): string {
    return "MultipleHighDensityRouteStitchSolver"
  }

  unsolvedRoutes: UnsolvedRoute[]
  activeSolver: SingleHighDensityRouteStitchSolver | null = null
  mergedHdRoutes: HighDensityIntraNodeRoute[] = []
  colorMap: Record<string, string> = {}
  defaultTraceThickness: number
  defaultViaDiameter: number

  private getClosestEndpointHash(
    routes: HighDensityIntraNodeRoute[],
    point: { x: number; y: number; z: number },
  ) {
    let bestHash: string | null = null
    let bestDist = Infinity

    for (const route of routes) {
      const endpoints = [route.route[0]!, route.route[route.route.length - 1]!]
      for (const endpoint of endpoints) {
        const dist = distance(point, endpoint)
        if (dist < bestDist) {
          bestDist = dist
          bestHash = roundedPointHash(endpoint)
        }
      }
    }

    return bestHash
  }

  private selectRoutesAlongEndpointPath(
    hdRoutes: HighDensityIntraNodeRoute[],
    start: { x: number; y: number; z: number },
    end: { x: number; y: number; z: number },
  ) {
    if (hdRoutes.length <= 2) return hdRoutes

    const startHash = this.getClosestEndpointHash(hdRoutes, start)
    const endHash = this.getClosestEndpointHash(hdRoutes, end)

    if (!startHash || !endHash || startHash === endHash) return hdRoutes

    const adjacency = new Map<
      string,
      Array<{ nextHash: string; routeIndex: number }>
    >()

    for (let i = 0; i < hdRoutes.length; i++) {
      const { startHash: routeStartHash, endHash: routeEndHash } =
        getEndpointHashes(hdRoutes[i]!)

      const startEntries = adjacency.get(routeStartHash) ?? []
      startEntries.push({ nextHash: routeEndHash, routeIndex: i })
      adjacency.set(routeStartHash, startEntries)

      const endEntries = adjacency.get(routeEndHash) ?? []
      endEntries.push({ nextHash: routeStartHash, routeIndex: i })
      adjacency.set(routeEndHash, endEntries)
    }

    const queue = [startHash]
    const visitedHashes = new Set<string>([startHash])
    const prevByHash = new Map<
      string,
      { prevHash: string; routeIndex: number }
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

    if (!visitedHashes.has(endHash)) return hdRoutes

    const selectedRouteIndexes = new Set<number>()
    let cursorHash = endHash
    while (cursorHash !== startHash) {
      const prev = prevByHash.get(cursorHash)
      if (!prev) return hdRoutes
      selectedRouteIndexes.add(prev.routeIndex)
      cursorHash = prev.prevHash
    }

    if (selectedRouteIndexes.size === 0) return hdRoutes

    const selectedRoutes = hdRoutes.filter((_, index) =>
      selectedRouteIndexes.has(index),
    )

    return selectedRoutes
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

    const firstRoute = params.hdRoutes[0]
    this.defaultTraceThickness = firstRoute?.traceThickness ?? 0.15
    this.defaultViaDiameter =
      firstRoute?.viaDiameter ?? params.defaultViaDiameter ?? 0.3

    const routeIslandConnectivityMap = new ConnectivityMap({})
    const routeIslandConnections: Array<string[]> = []
    const routeIslands = []

    const pointHashCounts = new Map<string, number>()

    for (let i = 0; i < params.hdRoutes.length; i++) {
      const hdRoute = params.hdRoutes[i]
      const start = hdRoute.route[0]
      const end = hdRoute.route[hdRoute.route.length - 1]
      routeIslandConnections.push([
        `route_island_${i}`,
        `${hdRoute.connectionName}:${roundedPointHash(start)}`,
        `${hdRoute.connectionName}:${roundedPointHash(end)}`,
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

      const hdRoutes = params.hdRoutes.filter((r, i) =>
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

      const possibleEndpoints2 = []
      for (const possibleEndpoint1 of possibleEndpoints1) {
        const pointHash = `${hdRoutes[0].connectionName}:${roundedPointHash(possibleEndpoint1)}`
        if (pointHashCounts.get(pointHash) === 1) {
          possibleEndpoints2.push(possibleEndpoint1)
        }
      }
      // Not sure why this happens
      // If removing, make sure off-board-assignable2 doesn't break
      if (possibleEndpoints2.length === 0) {
        console.log("no possible endpoints, can't stitch")
        continue
      }

      let start: { x: number; y: number; z: number }
      let end: { x: number; y: number; z: number }

      if (possibleEndpoints2.length !== 2) {
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
      } else {
        start = possibleEndpoints2[0]
        end = possibleEndpoints2[1]

        if (
          distance(start, connection.pointsToConnect[1]) <
          distance(end, connection.pointsToConnect[0])
        ) {
          ;[start, end] = [end, start]
        }
      }

      const selectedHdRoutes = this.selectRoutesAlongEndpointPath(
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

    const unsolvedRoutesByConnection = new Map<string, UnsolvedRoute[]>()
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

      if (!hasDegenerateRoute) {
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
          hdRoutes: this.selectRoutesAlongEndpointPath(hdRoutes, start, end),
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
        if (this.activeSolver instanceof SingleHighDensityRouteStitchSolver) {
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

    this.activeSolver = new SingleHighDensityRouteStitchSolver({
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
      title: "Multiple High Density Route Stitch Solver",
    }

    // Visualize the active solver if one exists
    if (this.activeSolver) {
      // Combine visualizations from the active solver
      const activeSolverGraphics = this.activeSolver.visualize()

      // Merge points
      if (activeSolverGraphics.points?.length) {
        graphics.points?.push(...activeSolverGraphics.points)
      }

      // Merge lines
      if (activeSolverGraphics.lines?.length) {
        graphics.lines?.push(...activeSolverGraphics.lines)
      }

      // Merge circles
      if (activeSolverGraphics.circles?.length) {
        graphics.circles?.push(...activeSolverGraphics.circles)
      }

      // Merge rects if they exist
      if (activeSolverGraphics.rects?.length) {
        if (!graphics.rects) graphics.rects = []
        graphics.rects.push(...activeSolverGraphics.rects)
      }
    }

    // Visualize all merged HD routes that have been solved
    for (const [i, mergedRoute] of this.mergedHdRoutes.entries()) {
      const solvedColor =
        this.colorMap[mergedRoute.connectionName] ??
        `hsl(120, 100%, ${40 + ((i * 10) % 40)}%)` // Different shades of green

      // Visualize the route path segment by segment
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

      // Visualize route points (apply transparency based on Z)
      for (const point of mergedRoute.route) {
        const pointColor =
          point.z !== 0 ? safeTransparentize(solvedColor, 0.5) : solvedColor
        graphics.points?.push({
          x: point.x,
          y: point.y,
          color: pointColor,
        })
      }

      // Visualize vias in the merged route (Vias inherently connect layers, keep solid for now)
      // TODO: Consider if via transparency should depend on connected layers
      for (const via of mergedRoute.vias) {
        graphics.circles?.push({
          center: { x: via.x, y: via.y },
          radius: mergedRoute.viaDiameter / 2,
          fill: solvedColor, // Keep vias solid color for visibility
        })
      }

      // Visualize jumpers in the merged route
      if (mergedRoute.jumpers && mergedRoute.jumpers.length > 0) {
        const jumperGraphics = getJumpersGraphics(mergedRoute.jumpers, {
          color: solvedColor,
          label: mergedRoute.connectionName,
        })
        graphics.rects!.push(...(jumperGraphics.rects ?? []))
        graphics.lines!.push(...(jumperGraphics.lines ?? []))
      }
    }

    // Visualize all remaining unsolved routes - start/end points only
    for (const unsolvedRoute of this.unsolvedRoutes) {
      const routeColor = this.colorMap[unsolvedRoute.connectionName] ?? "gray" // Use colorMap, default to gray

      // Add start and end points for unsolved connections
      graphics.points?.push(
        {
          x: unsolvedRoute.start.x,
          y: unsolvedRoute.start.y,
          color: routeColor,
          label: `${unsolvedRoute.connectionName} Start (z=${unsolvedRoute.start.z})`,
        },
        {
          x: unsolvedRoute.end.x,
          y: unsolvedRoute.end.y,
          color: routeColor,
          label: `${unsolvedRoute.connectionName} End (z=${unsolvedRoute.end.z})`,
        },
      )

      // Add a light dashed line between start and end to show pending connections
      graphics.lines?.push({
        points: [
          { x: unsolvedRoute.start.x, y: unsolvedRoute.start.y },
          { x: unsolvedRoute.end.x, y: unsolvedRoute.end.y },
        ],
        strokeColor: routeColor,
        strokeDash: "2 2",
      })

      // Visualize HD routes associated with unsolved routes (faded)
      for (const hdRoute of unsolvedRoute.hdRoutes) {
        if (hdRoute.route.length > 1) {
          graphics.lines?.push({
            points: hdRoute.route.map((point) => ({ x: point.x, y: point.y })),
            strokeColor: safeTransparentize(routeColor, 0.5), // Use routeColor
            strokeDash: "10 5",
          })
        }

        // Visualize vias
        for (const via of hdRoute.vias) {
          graphics.circles?.push({
            center: { x: via.x, y: via.y },
            radius: hdRoute.viaDiameter / 2,
            fill: routeColor, // Use routeColor
          })
        }

        // Visualize jumpers
        if (hdRoute.jumpers && hdRoute.jumpers.length > 0) {
          const jumperGraphics = getJumpersGraphics(hdRoute.jumpers, {
            color: routeColor,
            label: hdRoute.connectionName,
          })
          graphics.rects!.push(...(jumperGraphics.rects ?? []))
          graphics.lines!.push(...(jumperGraphics.lines ?? []))
        }
      }
    }

    return graphics
  }
}
