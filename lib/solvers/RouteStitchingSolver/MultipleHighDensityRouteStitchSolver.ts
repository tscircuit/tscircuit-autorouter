import { distance } from "@tscircuit/math-utils"
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

const GEOMETRIC_TOLERANCE = 1e-3
const VIA_PENALTY = 1000
const GAP_PENALTY = 100000

const isStitchableRoute = (route: HighDensityIntraNodeRoute) =>
  route.route.length >= 2

const getRouteLength = (route: HighDensityIntraNodeRoute) =>
  route.route.slice(0, -1).reduce((sum, point, index) => {
    const nextPoint = route.route[index + 1]!
    return sum + distance(point, nextPoint)
  }, 0)

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

  private getTransitionScore(
    A: { x: number; y: number; z: number },
    B: { x: number; y: number; z: number },
  ) {
    const dist = distance(A, B)
    if (A.z === B.z) {
      return dist < GEOMETRIC_TOLERANCE ? dist : GAP_PENALTY + dist
    }

    return dist < GEOMETRIC_TOLERANCE ? VIA_PENALTY + dist : GAP_PENALTY + dist
  }

  private selectRoutesForConnectionPath(
    hdRoutes: HighDensityIntraNodeRoute[],
    start: { x: number; y: number; z: number },
    end: { x: number; y: number; z: number },
  ) {
    const stitchableRoutes = hdRoutes.filter(isStitchableRoute)
    if (stitchableRoutes.length <= 1) {
      return stitchableRoutes.length === 1 ? stitchableRoutes : hdRoutes
    }

    type GraphEdge = {
      to: string
      weight: number
      routeIndex?: number
    }

    const graph = new Map<string, GraphEdge[]>()
    const addEdge = (from: string, edge: GraphEdge) => {
      const edges = graph.get(from) ?? []
      edges.push(edge)
      graph.set(from, edges)
    }

    const endpointIds = stitchableRoutes.map((route, routeIndex) => ({
      startId: `route_${routeIndex}_start`,
      endId: `route_${routeIndex}_end`,
      startPoint: route.route[0]!,
      endPoint: route.route[route.route.length - 1]!,
      routeLength: getRouteLength(route),
    }))

    for (let i = 0; i < endpointIds.length; i++) {
      const endpoint = endpointIds[i]!
      const routeTraversalCost = endpoint.routeLength * 1e-3
      addEdge(endpoint.startId, {
        to: endpoint.endId,
        weight: routeTraversalCost,
        routeIndex: i,
      })
      addEdge(endpoint.endId, {
        to: endpoint.startId,
        weight: routeTraversalCost,
        routeIndex: i,
      })
    }

    for (let i = 0; i < endpointIds.length; i++) {
      const A = endpointIds[i]!
      const AEndpoints = [
        { id: A.startId, point: A.startPoint },
        { id: A.endId, point: A.endPoint },
      ]

      for (let j = i + 1; j < endpointIds.length; j++) {
        const B = endpointIds[j]!
        const BEndpoints = [
          { id: B.startId, point: B.startPoint },
          { id: B.endId, point: B.endPoint },
        ]

        for (const endpointA of AEndpoints) {
          for (const endpointB of BEndpoints) {
            const weight = this.getTransitionScore(
              endpointA.point,
              endpointB.point,
            )
            addEdge(endpointA.id, { to: endpointB.id, weight })
            addEdge(endpointB.id, { to: endpointA.id, weight })
          }
        }
      }
    }

    const startId = "__start__"
    const endId = "__end__"
    for (const endpoint of endpointIds) {
      addEdge(startId, {
        to: endpoint.startId,
        weight: this.getTransitionScore(start, endpoint.startPoint),
      })
      addEdge(startId, {
        to: endpoint.endId,
        weight: this.getTransitionScore(start, endpoint.endPoint),
      })
      addEdge(endpoint.startId, {
        to: endId,
        weight: this.getTransitionScore(endpoint.startPoint, end),
      })
      addEdge(endpoint.endId, {
        to: endId,
        weight: this.getTransitionScore(endpoint.endPoint, end),
      })
    }

    const dist = new Map<string, number>([[startId, 0]])
    const prev = new Map<string, { from: string; routeIndex?: number }>()
    const visited = new Set<string>()
    const queue = new Set<string>([startId])

    while (queue.size > 0) {
      let current: string | null = null
      let bestDist = Infinity
      for (const node of queue) {
        const nodeDist = dist.get(node) ?? Infinity
        if (nodeDist < bestDist) {
          bestDist = nodeDist
          current = node
        }
      }

      if (!current) break
      queue.delete(current)
      if (current === endId) break
      if (visited.has(current)) continue
      visited.add(current)

      for (const edge of graph.get(current) ?? []) {
        const nextDist = bestDist + edge.weight
        if (nextDist >= (dist.get(edge.to) ?? Infinity)) continue
        dist.set(edge.to, nextDist)
        prev.set(edge.to, { from: current, routeIndex: edge.routeIndex })
        queue.add(edge.to)
      }
    }

    if (!dist.has(endId)) return stitchableRoutes

    const orderedRouteIndexes: number[] = []
    const seenRouteIndexes = new Set<number>()
    let cursor = endId
    while (cursor !== startId) {
      const prevEntry = prev.get(cursor)
      if (!prevEntry) return stitchableRoutes
      if (
        prevEntry.routeIndex !== undefined &&
        !seenRouteIndexes.has(prevEntry.routeIndex)
      ) {
        seenRouteIndexes.add(prevEntry.routeIndex)
        orderedRouteIndexes.push(prevEntry.routeIndex)
      }
      cursor = prevEntry.from
    }

    orderedRouteIndexes.reverse()
    return orderedRouteIndexes.length > 0
      ? orderedRouteIndexes.map((routeIndex) => stitchableRoutes[routeIndex]!)
      : stitchableRoutes
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

    this.unsolvedRoutes = []

    const connectionNames = Array.from(
      new Set(params.hdRoutes.map((route) => route.connectionName)),
    )

    for (const connectionName of connectionNames) {
      const hdRoutes = params.hdRoutes.filter(
        (route) => route.connectionName === connectionName,
      )
      if (hdRoutes.length === 0) continue

      const connection = params.connections.find(
        (c) => c.name === connectionName,
      )
      if (!connection) continue

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

      this.unsolvedRoutes.push({
        connectionName,
        hdRoutes: this.selectRoutesForConnectionPath(hdRoutes, start, end),
        start,
        end,
      })
    }

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
