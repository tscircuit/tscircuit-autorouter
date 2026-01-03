import type {
  HighDensityIntraNodeRoute,
  HighDensityIntraNodeRouteWithJumpers,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../../solvers/BaseSolver"
import { SimpleHighDensitySolver } from "./SimpleHighDensitySolver"
import { HyperIntraNodeSolverWithJumpers } from "../../solvers/HighDensitySolver/HyperIntraNodeSolverWithJumpers"
import { getIntraNodeCrossings } from "../../utils/getIntraNodeCrossings"
import { safeTransparentize } from "../../solvers/colors"
import { mergeRouteSegments } from "lib/utils/mergeRouteSegments"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityHyperParameters } from "../../solvers/HighDensitySolver/HighDensityHyperParameters"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"

/**
 * A unified route type that can represent both regular routes (with vias)
 * and single-layer routes (with jumpers)
 */
export type UnifiedHighDensityRoute =
  | (HighDensityIntraNodeRoute & { hasJumpers?: false })
  | (HighDensityIntraNodeRouteWithJumpers & { hasJumpers: true })

/**
 * Convert a route with jumpers to a standard route format (for compatibility)
 * The jumpers are preserved in the jumpers array but vias is empty
 */
function convertJumperRouteToStandard(
  route: HighDensityIntraNodeRouteWithJumpers,
): HighDensityIntraNodeRoute & {
  jumpers?: HighDensityIntraNodeRouteWithJumpers["jumpers"]
} {
  return {
    connectionName: route.connectionName,
    rootConnectionName: route.rootConnectionName,
    traceThickness: route.traceThickness,
    viaDiameter: 0, // No vias in jumper routes
    route: route.route,
    vias: [], // No vias, we use jumpers instead
    // Preserve jumpers for conversion
    jumpers: route.jumpers,
  }
}

interface NodeAnalysis {
  node: NodeWithPortPoints
  hasCrossings: boolean
  numSameLayerCrossings: number
}

/**
 * HighDensitySolver intelligently selects the appropriate solver for each node:
 * - SimpleHighDensitySolver for nodes without crossings (faster, force-directed)
 * - IntraNodeSolverWithJumpers for single-layer nodes with crossings (uses 0603 jumpers)
 *
 * This solver processes nodes in batches based on their characteristics.
 */
export class JumperHighDensitySolver extends BaseSolver {
  allNodes: NodeWithPortPoints[]
  nodeAnalyses: NodeAnalysis[]
  routes: HighDensityIntraNodeRoute[]
  colorMap: Record<string, string>
  traceWidth: number
  viaDiameter: number
  connMap?: ConnectivityMap
  hyperParameters?: Partial<HighDensityHyperParameters>

  // Nodes grouped by solver type
  nodesWithoutCrossings: NodeWithPortPoints[]
  nodesWithCrossings: NodeWithPortPoints[]

  // Sub-solvers
  simpleHighDensitySolver?: SimpleHighDensitySolver
  jumperSolvers: HyperIntraNodeSolverWithJumpers[]
  currentJumperSolverIndex: number

  // State
  phase: "analyzing" | "simple" | "jumpers" | "done"

  constructor({
    nodePortPoints,
    colorMap,
    traceWidth = 0.1,
    viaDiameter = 0.6,
    connMap,
    hyperParameters,
  }: {
    nodePortPoints: NodeWithPortPoints[]
    colorMap?: Record<string, string>
    traceWidth?: number
    viaDiameter?: number
    connMap?: ConnectivityMap
    hyperParameters?: Partial<HighDensityHyperParameters>
  }) {
    super()
    this.allNodes = [...nodePortPoints]
    this.colorMap = colorMap ?? {}
    this.routes = []
    this.traceWidth = traceWidth
    this.viaDiameter = viaDiameter
    this.connMap = connMap
    this.hyperParameters = hyperParameters

    this.nodesWithoutCrossings = []
    this.nodesWithCrossings = []
    this.nodeAnalyses = []
    this.jumperSolvers = []
    this.currentJumperSolverIndex = 0
    this.phase = "analyzing"

    // Analyze nodes upfront
    this._analyzeNodes()

    // Calculate max iterations
    const simpleIterations = this.nodesWithoutCrossings.length * 10 + 1
    const jumperIterations = this.nodesWithCrossings.length * 100000
    this.MAX_ITERATIONS = simpleIterations + jumperIterations + 100
  }

  /**
   * Analyze all nodes to determine which solver to use for each
   */
  _analyzeNodes() {
    for (const node of this.allNodes) {
      const crossings = getIntraNodeCrossingsUsingCircle(node)

      const analysis: NodeAnalysis = {
        node,
        hasCrossings: crossings.numSameLayerCrossings > 0,
        numSameLayerCrossings: crossings.numSameLayerCrossings,
      }

      this.nodeAnalyses.push(analysis)

      // Route to appropriate solver
      if (crossings.numSameLayerCrossings > 0) {
        // Single-layer with crossings -> use jumpers
        this.nodesWithCrossings.push(node)
      } else {
        // No crossings or multi-layer -> use simple solver
        this.nodesWithoutCrossings.push(node)
      }
    }

    // Move to next phase and initialize appropriate solvers
    if (this.nodesWithoutCrossings.length > 0) {
      this.phase = "simple"
    } else if (this.nodesWithCrossings.length > 0) {
      this.phase = "jumpers"
      // Initialize jumper solvers immediately since we're skipping simple phase
      this._initializeJumperSolvers()
    } else {
      this.phase = "done"
    }
  }

  _step() {
    switch (this.phase) {
      case "analyzing":
        // Already done in constructor
        this.phase =
          this.nodesWithoutCrossings.length > 0 ? "simple" : "jumpers"
        break

      case "simple":
        this._stepSimpleSolver()
        break

      case "jumpers":
        this._stepJumperSolvers()
        break

      case "done":
        this.solved = true
        break
    }
  }

  _stepSimpleSolver() {
    // Initialize simple solver if not yet created
    if (!this.simpleHighDensitySolver) {
      if (this.nodesWithoutCrossings.length === 0) {
        // No nodes without crossings, skip to jumpers phase
        this.phase = "jumpers"
        // Initialize jumper solvers now since we're skipping simple phase
        this._initializeJumperSolvers()
        return
      }

      this.simpleHighDensitySolver = new SimpleHighDensitySolver({
        nodePortPoints: this.nodesWithoutCrossings,
        colorMap: this.colorMap,
        traceWidth: this.traceWidth,
        viaDiameter: this.viaDiameter,
      })
    }

    this.simpleHighDensitySolver.step()

    if (this.simpleHighDensitySolver.solved) {
      // Collect routes from simple solver
      this.routes.push(...this.simpleHighDensitySolver.routes)

      // Move to jumper phase
      this.phase = this.nodesWithCrossings.length > 0 ? "jumpers" : "done"

      // Initialize jumper solvers
      if (this.phase === "jumpers") {
        this._initializeJumperSolvers()
      }
    } else if (this.simpleHighDensitySolver.failed) {
      this.error = `SimpleHighDensitySolver failed: ${this.simpleHighDensitySolver.error}`
      this.failed = true
    }
  }

  _initializeJumperSolvers() {
    for (const node of this.nodesWithCrossings) {
      const solver = new HyperIntraNodeSolverWithJumpers({
        nodeWithPortPoints: node,
        colorMap: this.colorMap,
        connMap: this.connMap,
        traceWidth: this.traceWidth,
        hyperParameters: {
          ...this.hyperParameters,
          FUTURE_CONNECTION_PROXIMITY_VD: 50,
          FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 1,
        },
      })
      this.jumperSolvers.push(solver)
    }
  }

  _stepJumperSolvers() {
    if (this.jumperSolvers.length === 0) {
      this.phase = "done"
      this.solved = true
      return
    }

    const currentSolver = this.jumperSolvers[this.currentJumperSolverIndex]
    this.activeSubSolver = currentSolver
    if (!currentSolver) {
      this.phase = "done"
      this.solved = true
      return
    }

    currentSolver.step()

    if (currentSolver.solved) {
      // Convert jumper routes to unified format and collect
      for (const jumperRoute of currentSolver.solvedRoutes) {
        this.routes.push(convertJumperRouteToStandard(jumperRoute))
      }

      this.currentJumperSolverIndex++

      if (this.currentJumperSolverIndex >= this.jumperSolvers.length) {
        this.phase = "done"
        this.solved = true
      }
    } else if (currentSolver.failed) {
      this.error = `HyperIntraNodeSolverWithJumpers failed for node: ${currentSolver.nodeWithPortPoints.capacityMeshNodeId}: ${currentSolver.error}`
      this.failed = true
    }
  }

  computeProgress(): number {
    const totalNodes = this.allNodes.length
    if (totalNodes === 0) return 1

    let completedNodes = 0

    // Count completed from simple solver
    if (this.simpleHighDensitySolver) {
      const simpleProgress = this.simpleHighDensitySolver.solved
        ? this.nodesWithoutCrossings.length
        : Math.floor(
            this.simpleHighDensitySolver.progress *
              this.nodesWithoutCrossings.length,
          )
      completedNodes += simpleProgress
    }

    // Count completed from jumper solvers
    completedNodes += this.currentJumperSolverIndex

    // Add progress from current jumper solver
    const currentJumperSolver =
      this.jumperSolvers[this.currentJumperSolverIndex]
    if (currentJumperSolver) {
      completedNodes += currentJumperSolver.progress
    }

    return completedNodes / totalNodes
  }

  getConstructorParams() {
    return {
      nodePortPoints: this.allNodes,
      colorMap: this.colorMap,
      traceWidth: this.traceWidth,
      viaDiameter: this.viaDiameter,
      connMap: this.connMap,
      hyperParameters: this.hyperParameters,
    }
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // If currently running a sub-solver, show its visualization
    if (this.phase === "simple" && this.simpleHighDensitySolver) {
      return this.simpleHighDensitySolver.visualize()
    }

    if (
      this.phase === "jumpers" &&
      this.jumperSolvers[this.currentJumperSolverIndex]
    ) {
      return this.jumperSolvers[this.currentJumperSolverIndex].visualize()
    }

    // Show completed routes
    for (const route of this.routes) {
      const mergedSegments = mergeRouteSegments(
        route.route,
        route.connectionName,
        this.colorMap[route.connectionName],
      )

      for (const segment of mergedSegments) {
        graphics.lines!.push({
          points: segment.points,
          label: segment.connectionName,
          strokeColor:
            segment.z === 0
              ? segment.color
              : safeTransparentize(segment.color, 0.75),
          layer: `z${segment.z}`,
          strokeWidth: route.traceThickness,
          strokeDash: segment.z !== 0 ? "10, 5" : undefined,
        })
      }

      // Draw vias
      for (const via of route.vias) {
        graphics.circles!.push({
          center: via,
          radius: route.viaDiameter / 2,
          fill: safeTransparentize(
            this.colorMap[route.connectionName] ?? "gray",
            0.5,
          ),
          layer: "via",
        })
      }

      // Draw jumpers if present
      if ("jumpers" in route && route.jumpers) {
        for (const jumper of route.jumpers) {
          const color = this.colorMap[route.connectionName] ?? "gray"

          // Determine jumper orientation to rotate pad dimensions
          const dx = jumper.end.x - jumper.start.x
          const dy = jumper.end.y - jumper.start.y
          const isHorizontal = Math.abs(dx) > Math.abs(dy)
          const padLength = 0.8
          const padWidth = 0.95
          const rectWidth = isHorizontal ? padLength : padWidth
          const rectHeight = isHorizontal ? padWidth : padLength

          // Draw start pad
          graphics.rects!.push({
            center: jumper.start,
            width: rectWidth,
            height: rectHeight,
            fill: safeTransparentize(color, 0.5),
            stroke: "rgba(0, 0, 0, 0.5)",
            layer: "jumper",
          })

          // Draw end pad
          graphics.rects!.push({
            center: jumper.end,
            width: rectWidth,
            height: rectHeight,
            fill: safeTransparentize(color, 0.5),
            stroke: "rgba(0, 0, 0, 0.5)",
            layer: "jumper",
          })

          // Draw connecting line
          graphics.lines!.push({
            points: [jumper.start, jumper.end],
            strokeColor: "rgba(100, 100, 100, 0.8)",
            strokeWidth: padWidth * 0.3,
            layer: "jumper-body",
          })
        }
      }
    }

    // Draw node boundaries with analysis info
    for (const analysis of this.nodeAnalyses) {
      const node = analysis.node
      const bounds = {
        minX: node.center.x - node.width / 2,
        maxX: node.center.x + node.width / 2,
        minY: node.center.y - node.height / 2,
        maxY: node.center.y + node.height / 2,
      }

      graphics.rects!.push({
        center: node.center,
        width: node.width,
        height: node.height,
        fill: analysis.hasCrossings
          ? "rgba(255, 200, 0, 0.1)" // Yellow for crossings
          : "rgba(0, 200, 0, 0.1)", // Green for no crossings
        stroke: analysis.hasCrossings
          ? "rgba(255, 150, 0, 0.5)"
          : "rgba(0, 150, 0, 0.5)",
        label: [
          node.capacityMeshNodeId,
          analysis.hasCrossings
            ? `crossings: ${analysis.numSameLayerCrossings}`
            : "no crossings",
        ].join("\n"),
      })
    }

    return graphics
  }
}
