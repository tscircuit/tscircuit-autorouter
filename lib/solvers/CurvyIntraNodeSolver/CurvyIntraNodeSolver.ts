import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "../../types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { CurvyTraceSolver } from "@tscircuit/curvy-trace-solver"
import type { CurvyTraceProblem, Obstacle } from "@tscircuit/curvy-trace-solver"

export interface AdjacentObstacle {
  minX: number
  minY: number
  maxX: number
  maxY: number
  networkId?: string
}

export interface CurvyIntraNodeSolverParams {
  nodeWithPortPoints: NodeWithPortPoints
  colorMap?: Record<string, string>
  traceWidth?: number
  viaDiameter?: number
  /** Obstacles from adjacent/solved nodes that might affect routing */
  adjacentObstacles?: AdjacentObstacle[]
}

/**
 * A solver that uses CurvyTraceSolver to create curved traces within a node.
 * It converts port points to waypoint pairs and generates smooth curved traces
 * that maximize distance between traces and obstacles.
 */
export class CurvyIntraNodeSolver extends BaseSolver {
  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  traceWidth: number
  viaDiameter: number
  adjacentObstacles: AdjacentObstacle[]

  routes: HighDensityIntraNodeRoute[] = []
  curvyTraceSolver?: CurvyTraceSolver
  phase: "initializing" | "solving" | "done" = "initializing"

  constructor(params: CurvyIntraNodeSolverParams) {
    super()
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.colorMap = params.colorMap ?? {}
    this.traceWidth = params.traceWidth ?? 0.15
    this.viaDiameter = params.viaDiameter ?? 0.6
    this.adjacentObstacles = params.adjacentObstacles ?? []
    this.MAX_ITERATIONS = 1000
  }

  _step() {
    switch (this.phase) {
      case "initializing":
        this._initializeCurvySolver()
        break
      case "solving":
        this._stepCurvySolver()
        break
      case "done":
        this.solved = true
        break
    }
  }

  _initializeCurvySolver() {
    const node = this.nodeWithPortPoints
    const bounds = {
      minX: node.center.x - node.width / 2,
      minY: node.center.y - node.height / 2,
      maxX: node.center.x + node.width / 2,
      maxY: node.center.y + node.height / 2,
    }

    // Group port points by connectionName to create waypoint pairs
    const connectionGroups = new Map<string, PortPoint[]>()
    for (const pt of node.portPoints) {
      if (!connectionGroups.has(pt.connectionName)) {
        connectionGroups.set(pt.connectionName, [])
      }
      connectionGroups.get(pt.connectionName)!.push(pt)
    }

    // Convert port point pairs to waypoint pairs
    // Use connectionName (not rootConnectionName) as networkId to keep different
    // MST connections separate, even if they share the same root connection
    const waypointPairs: CurvyTraceProblem["waypointPairs"] = []
    for (const [connectionName, points] of connectionGroups) {
      if (points.length < 2) continue

      // Use first and last points as start/end
      const startPoint = points[0]
      const endPoint = points[points.length - 1]

      waypointPairs.push({
        start: { x: startPoint.x, y: startPoint.y },
        end: { x: endPoint.x, y: endPoint.y },
        // Use connectionName to keep different MST connections separate
        networkId: connectionName,
      })
    }

    if (waypointPairs.length === 0) {
      this.phase = "done"
      return
    }

    // Convert adjacent obstacles to CurvyTraceSolver format
    const obstacles: Obstacle[] = this.adjacentObstacles.map((obs) => ({
      minX: obs.minX,
      minY: obs.minY,
      maxX: obs.maxX,
      maxY: obs.maxY,
      center: {
        x: (obs.minX + obs.maxX) / 2,
        y: (obs.minY + obs.maxY) / 2,
      },
      networkId: obs.networkId,
    }))

    const problem: CurvyTraceProblem = {
      bounds,
      waypointPairs,
      obstacles,
      preferredTraceToTraceSpacing: this.traceWidth * 2,
      preferredObstacleToTraceSpacing: this.traceWidth * 2,
    }

    this.curvyTraceSolver = new CurvyTraceSolver(problem)
    this.phase = "solving"
  }

  _stepCurvySolver() {
    if (!this.curvyTraceSolver) {
      this.phase = "done"
      return
    }

    // Set activeSubSolver so visualizations show the curvy trace solver
    this.activeSubSolver = this.curvyTraceSolver

    // Step the curvy trace solver incrementally
    this.curvyTraceSolver.step()

    if (this.curvyTraceSolver.solved) {
      // Convert output traces to HighDensityIntraNodeRoute format
      this._convertOutputTraces()
      this.phase = "done"
    } else if (this.curvyTraceSolver.failed) {
      this.error = this.curvyTraceSolver.error
      this.failed = true
    }
  }

  _convertOutputTraces() {
    if (!this.curvyTraceSolver) return

    const node = this.nodeWithPortPoints

    // Build a map from networkId (connectionName) to connection info
    // We use connectionName as networkId to keep different MST connections separate
    const connectionInfo = new Map<
      string,
      { connectionName: string; rootConnectionName?: string; z: number }
    >()
    for (const pt of node.portPoints) {
      // Use connectionName as networkId (matching waypointPairs above)
      const networkId = pt.connectionName
      if (!connectionInfo.has(networkId)) {
        connectionInfo.set(networkId, {
          connectionName: pt.connectionName,
          rootConnectionName: pt.rootConnectionName,
          z: pt.z,
        })
      }
    }

    for (const outputTrace of this.curvyTraceSolver.outputTraces) {
      const networkId = outputTrace.networkId ?? ""
      const info = connectionInfo.get(networkId)

      if (!info) continue

      const route: HighDensityIntraNodeRoute = {
        connectionName: info.connectionName,
        rootConnectionName: info.rootConnectionName,
        traceThickness: this.traceWidth,
        viaDiameter: this.viaDiameter,
        route: outputTrace.points.map((pt) => ({
          x: pt.x,
          y: pt.y,
          z: info.z,
        })),
        vias: [],
      }

      this.routes.push(route)
    }
  }

  getConstructorParams(): CurvyIntraNodeSolverParams {
    return {
      nodeWithPortPoints: this.nodeWithPortPoints,
      colorMap: this.colorMap,
      traceWidth: this.traceWidth,
      viaDiameter: this.viaDiameter,
      adjacentObstacles: this.adjacentObstacles,
    }
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    const node = this.nodeWithPortPoints

    // Draw node boundary
    graphics.rects!.push({
      center: node.center,
      width: node.width,
      height: node.height,
      fill: "rgba(0, 200, 0, 0.1)",
      stroke: "rgba(0, 200, 0, 0.5)",
      label: node.capacityMeshNodeId,
    })

    // Draw adjacent obstacles
    for (const obs of this.adjacentObstacles) {
      graphics.rects!.push({
        center: {
          x: (obs.minX + obs.maxX) / 2,
          y: (obs.minY + obs.maxY) / 2,
        },
        width: obs.maxX - obs.minX,
        height: obs.maxY - obs.minY,
        fill: "rgba(255, 0, 0, 0.1)",
        stroke: "rgba(255, 0, 0, 0.3)",
        label: `obstacle: ${obs.networkId ?? ""}`,
      })
    }

    // Draw curvy trace solver visualization if available
    if (this.curvyTraceSolver) {
      const curvyViz = this.curvyTraceSolver.visualize()
      if (curvyViz.lines) {
        graphics.lines!.push(...curvyViz.lines)
      }
      if (curvyViz.points) {
        graphics.points!.push(...curvyViz.points)
      }
      if (curvyViz.rects) {
        graphics.rects!.push(...curvyViz.rects)
      }
      if (curvyViz.circles) {
        graphics.circles!.push(...curvyViz.circles)
      }
    }

    // Draw completed routes
    for (const route of this.routes) {
      const color = this.colorMap[route.connectionName] ?? "gray"
      graphics.lines!.push({
        points: route.route.map((pt) => ({ x: pt.x, y: pt.y })),
        strokeColor: color,
        strokeWidth: this.traceWidth,
        label: route.connectionName,
      })
    }

    // Draw port points
    for (const pt of node.portPoints) {
      const color = this.colorMap[pt.connectionName] ?? "gray"
      graphics.points!.push({
        x: pt.x,
        y: pt.y,
        color,
        label: pt.connectionName,
      })
    }

    return graphics
  }
}
