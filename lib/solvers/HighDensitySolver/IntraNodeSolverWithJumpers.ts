import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRouteWithJumpers,
  NodeWithPortPoints,
  Jumper,
} from "../../types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { SingleHighDensityRouteWithJumpersSolver } from "./SingleHighDensityRouteWithJumpersSolver"
import { safeTransparentize } from "../colors"
import { HighDensityHyperParameters } from "./HighDensityHyperParameters"
import { cloneAndShuffleArray } from "lib/utils/cloneAndShuffleArray"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { getMinDistBetweenEnteringPoints } from "lib/utils/getMinDistBetweenEnteringPoints"

/**
 * 0603 footprint dimensions in mm for visualization
 */
const JUMPER_0603 = {
  length: 1.65,
  width: 0.95,
  padLength: 0.8,
  padWidth: 0.95,
}

/**
 * IntraNodeSolverWithJumpers is designed for single-layer nodes that use
 * 0603 jumpers to allow traces to jump over each other.
 *
 * Unlike the standard IntraNodeRouteSolver which uses vias to change layers,
 * this solver operates on a single layer and uses physical jumper components
 * to handle trace crossings.
 */
export class IntraNodeSolverWithJumpers extends BaseSolver {
  override getSolverName(): string {
    return "IntraNodeSolverWithJumpers"
  }

  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  unsolvedConnections: {
    connectionName: string
    rootConnectionName?: string
    points: { x: number; y: number; z: number }[]
  }[]

  totalConnections: number
  solvedRoutes: HighDensityIntraNodeRouteWithJumpers[]
  failedSubSolvers: SingleHighDensityRouteWithJumpersSolver[]
  hyperParameters: Partial<HighDensityHyperParameters>
  minDistBetweenEnteringPoints: number
  traceWidth: number

  activeSubSolver: SingleHighDensityRouteWithJumpersSolver | null = null
  lastActiveSubSolver: SingleHighDensityRouteWithJumpersSolver | null = null
  connMap?: ConnectivityMap

  // Legacy compat
  get failedSolvers() {
    return this.failedSubSolvers
  }

  // Legacy compat
  get activeSolver() {
    return this.activeSubSolver
  }

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints
    colorMap?: Record<string, string>
    hyperParameters?: Partial<HighDensityHyperParameters>
    connMap?: ConnectivityMap
    traceWidth?: number
  }) {
    const { nodeWithPortPoints, colorMap } = params
    super()
    this.nodeWithPortPoints = nodeWithPortPoints
    this.colorMap = colorMap ?? {}
    this.solvedRoutes = []
    this.hyperParameters = params.hyperParameters ?? {}
    this.failedSubSolvers = []
    this.connMap = params.connMap
    this.traceWidth = params.traceWidth ?? 0.15

    const unsolvedConnectionsMap: Map<
      string,
      {
        rootConnectionName?: string
        points: { x: number; y: number; z: number }[]
      }
    > = new Map()

    // For single-layer, force all port points to z=0
    for (const {
      connectionName,
      rootConnectionName,
      x,
      y,
    } of nodeWithPortPoints.portPoints) {
      const existing = unsolvedConnectionsMap.get(connectionName)
      unsolvedConnectionsMap.set(connectionName, {
        rootConnectionName: existing?.rootConnectionName ?? rootConnectionName,
        points: [...(existing?.points ?? []), { x, y, z: 0 }],
      })
    }

    this.unsolvedConnections = Array.from(
      unsolvedConnectionsMap
        .entries()
        .map(([connectionName, { rootConnectionName, points }]) => ({
          connectionName,
          rootConnectionName,
          points,
        })),
    )

    if (this.hyperParameters.SHUFFLE_SEED) {
      this.unsolvedConnections = cloneAndShuffleArray(
        this.unsolvedConnections,
        this.hyperParameters.SHUFFLE_SEED ?? 0,
      )

      this.unsolvedConnections = this.unsolvedConnections.map(
        ({ points, ...rest }, i) => ({
          ...rest,
          points: cloneAndShuffleArray(
            points,
            i * 7117 + (this.hyperParameters.SHUFFLE_SEED ?? 0),
          ),
        }),
      )
    }

    this.totalConnections = this.unsolvedConnections.length
    this.MAX_ITERATIONS = 1_000 * this.totalConnections ** 1.5

    this.minDistBetweenEnteringPoints = getMinDistBetweenEnteringPoints(
      this.nodeWithPortPoints,
    )
  }

  getConstructorParams() {
    return {
      nodeWithPortPoints: this.nodeWithPortPoints,
      colorMap: this.colorMap,
      hyperParameters: this.hyperParameters,
      connMap: this.connMap,
      traceWidth: this.traceWidth,
    }
  }

  computeProgress() {
    return (
      (this.solvedRoutes.length + (this.activeSubSolver?.progress || 0)) /
      this.totalConnections
    )
  }

  _step() {
    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      this.progress = this.computeProgress()
      if (this.activeSubSolver.solved) {
        this.solvedRoutes.push(this.activeSubSolver.solvedPath!)
        this.lastActiveSubSolver = this.activeSubSolver
        this.activeSubSolver = null
      } else if (this.activeSubSolver.failed) {
        this.failedSubSolvers.push(this.activeSubSolver)
        this.lastActiveSubSolver = this.activeSubSolver
        this.activeSubSolver = null
        this.error = this.failedSubSolvers.map((s) => s.error).join("\n")
        this.failed = true
      }
      return
    }

    const unsolvedConnection = this.unsolvedConnections.pop()
    this.progress = this.computeProgress()
    if (!unsolvedConnection) {
      this.solved = this.failedSubSolvers.length === 0
      return
    }
    if (unsolvedConnection.points.length === 1) {
      return
    }
    if (unsolvedConnection.points.length === 2) {
      const [A, B] = unsolvedConnection.points
      const sameX = Math.abs(A.x - B.x) < 1e-6
      const sameY = Math.abs(A.y - B.y) < 1e-6

      if (sameX && sameY) {
        // Same point, nothing to route
        return
      }
    }

    const { connectionName, rootConnectionName, points } = unsolvedConnection
    this.activeSubSolver = new SingleHighDensityRouteWithJumpersSolver({
      connectionName,
      rootConnectionName,
      minDistBetweenEnteringPoints: this.minDistBetweenEnteringPoints,
      bounds: getBoundsFromNodeWithPortPoints(this.nodeWithPortPoints),
      A: { x: points[0].x, y: points[0].y, z: 0 },
      B: {
        x: points[points.length - 1].x,
        y: points[points.length - 1].y,
        z: 0,
      },
      obstacleRoutes: this.solvedRoutes.filter((sr) => {
        // Skip routes with same root connection
        if (
          rootConnectionName &&
          sr.rootConnectionName === rootConnectionName
        ) {
          return false
        }
        // Skip routes that are connected via connMap
        if (this.connMap?.areIdsConnected(sr.connectionName, connectionName)) {
          return false
        }
        return true
      }),
      futureConnections: this.unsolvedConnections,
      hyperParameters: this.hyperParameters,
      connMap: this.connMap,
      traceThickness: this.traceWidth,
    })
  }

  /**
   * Draw the two pads of an 0603 jumper
   * Pad dimensions are rotated based on jumper orientation
   */
  private drawJumperPads(
    graphics: GraphicsObject,
    jumper: Jumper,
    color: string,
    step?: number,
  ) {
    const dx = jumper.end.x - jumper.start.x
    const dy = jumper.end.y - jumper.start.y

    const padLength = JUMPER_0603.padLength
    const padWidth = JUMPER_0603.padWidth

    // Determine if jumper is horizontal or vertical
    // Horizontal: dx != 0, dy ~= 0 -> pads are taller than wide (width=padLength, height=padWidth)
    // Vertical: dx ~= 0, dy != 0 -> pads are wider than tall (width=padWidth, height=padLength)
    const isHorizontal = Math.abs(dx) > Math.abs(dy)
    const rectWidth = isHorizontal ? padLength : padWidth
    const rectHeight = isHorizontal ? padWidth : padLength

    // Start pad
    graphics.rects!.push({
      center: {
        x: jumper.start.x,
        y: jumper.start.y,
      },
      width: rectWidth,
      height: rectHeight,
      fill: color,
      stroke: "rgba(0, 0, 0, 0.5)",
      layer: "jumper",
    })

    // End pad
    graphics.rects!.push({
      center: {
        x: jumper.end.x,
        y: jumper.end.y,
      },
      width: rectWidth,
      height: rectHeight,
      fill: color,
      stroke: "rgba(0, 0, 0, 0.5)",
      layer: "jumper",
    })

    // Draw a line connecting the pads (representing the jumper body)
    graphics.lines!.push({
      points: [jumper.start, jumper.end],
      strokeColor: "rgba(100, 100, 100, 0.8)",
      strokeWidth: padWidth * 0.3,
      layer: "jumper-body",
    })
  }

  visualize(): GraphicsObject {
    if (this.activeSubSolver && !this.solved) {
      return this.activeSubSolver.visualize()
    }
    if (this.failed && this.lastActiveSubSolver) {
      return this.lastActiveSubSolver.visualize()
    }
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Visualize input nodeWithPortPoints
    for (const pt of this.nodeWithPortPoints.portPoints) {
      graphics.points!.push({
        x: pt.x,
        y: pt.y,
        label: [pt.connectionName, "layer: 0 (single-layer)"].join("\n"),
        color: this.colorMap[pt.connectionName] ?? "blue",
      })
    }

    // Visualize solvedRoutes
    for (
      let routeIndex = 0;
      routeIndex < this.solvedRoutes.length;
      routeIndex++
    ) {
      const route = this.solvedRoutes[routeIndex]
      if (route.route.length > 0) {
        const routeColor = this.colorMap[route.connectionName] ?? "blue"

        // Draw route segments between points
        for (let i = 0; i < route.route.length - 1; i++) {
          const p1 = route.route[i]
          const p2 = route.route[i + 1]

          graphics.lines!.push({
            points: [p1, p2],
            strokeColor: safeTransparentize(routeColor, 0.2),
            layer: "route-layer-0",
            strokeWidth: route.traceThickness,
          })
        }

        // Draw jumpers
        for (const jumper of route.jumpers) {
          this.drawJumperPads(
            graphics,
            jumper,
            safeTransparentize(routeColor, 0.5),
            routeIndex,
          )
        }
      }
    }

    // Draw border around the node
    const bounds = getBoundsFromNodeWithPortPoints(this.nodeWithPortPoints)
    const { minX, minY, maxX, maxY } = bounds

    graphics.lines!.push({
      points: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
        { x: minX, y: minY },
      ],
      strokeColor: "rgba(255, 0, 0, 0.25)",
      strokeDash: "4 4",
      layer: "border",
    })

    return graphics
  }
}
