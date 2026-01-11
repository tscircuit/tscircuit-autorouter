import type {
  HighDensityIntraNodeRoute,
  HighDensityIntraNodeRouteWithJumpers,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../../solvers/BaseSolver"
import { SimpleHighDensitySolver } from "./SimpleHighDensitySolver"
// import { HyperIntraNodeSolverWithJumpers } from "../../solvers/HighDensitySolver/HyperIntraNodeSolverWithJumpers"
// import { JumperPrepatternSolver2_HyperGraph } from "../../solvers/JumperPrepatternSolver/JumperPrepatternSolver2_HyperGraph"
import { HyperJumperPrepatternSolver2 } from "../../solvers/JumperPrepatternSolver/HyperJumperPrepatternSolver2"
import { getIntraNodeCrossings } from "../../utils/getIntraNodeCrossings"
import { safeTransparentize } from "../../solvers/colors"
import { mergeRouteSegments } from "lib/utils/mergeRouteSegments"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityHyperParameters } from "../../solvers/HighDensitySolver/HighDensityHyperParameters"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import { JUMPER_DIMENSIONS } from "../../utils/jumperSizes"
import type { Jumper as SrjJumper } from "../../types/srj-types"
import type {
  CapacityMeshNode,
  CapacityMeshEdge,
} from "../../types/capacity-mesh-types"
import {
  CurvyIntraNodeSolver,
  type AdjacentObstacle,
} from "../../solvers/CurvyIntraNodeSolver/CurvyIntraNodeSolver"

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
 * - CurvyIntraNodeSolver for nodes without crossings (uses curvy trace solver)
 * - IntraNodeSolverWithJumpers for single-layer nodes with crossings (uses 0603 jumpers)
 *
 * This solver processes nodes one at a time, passing adjacent obstacles from
 * already-solved routes to maximize trace spacing.
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

  // Capacity mesh data for obstacle computation
  capacityMeshNodes: CapacityMeshNode[]
  capacityMeshEdges: CapacityMeshEdge[]
  capacityMeshNodeMap: Map<string, CapacityMeshNode>
  nodeAdjacencyMap: Map<string, Set<string>>

  // Nodes grouped by solver type
  nodesWithoutCrossings: NodeWithPortPoints[]
  nodesWithCrossings: NodeWithPortPoints[]

  // Sub-solvers for nodes without crossings (curvy trace solver)
  curvyIntraNodeSolvers: CurvyIntraNodeSolver[]
  currentCurvySolverIndex: number

  // Sub-solvers for nodes with crossings (jumper solver)
  // jumperSolvers: HyperIntraNodeSolverWithJumpers[]
  // jumperSolvers: JumperPrepatternSolver2_HyperGraph[]
  jumperSolvers: HyperJumperPrepatternSolver2[]
  currentJumperSolverIndex: number

  // State
  phase: "analyzing" | "curvy" | "jumpers" | "done"

  // All jumpers collected from jumper solvers (SRJ format with connectedTo populated)
  jumpers: SrjJumper[] = []

  constructor({
    nodePortPoints,
    colorMap,
    traceWidth = 0.15,
    viaDiameter = 0.6,
    connMap,
    hyperParameters,
    capacityMeshNodes = [],
    capacityMeshEdges = [],
  }: {
    nodePortPoints: NodeWithPortPoints[]
    colorMap?: Record<string, string>
    traceWidth?: number
    viaDiameter?: number
    connMap?: ConnectivityMap
    hyperParameters?: Partial<HighDensityHyperParameters>
    capacityMeshNodes?: CapacityMeshNode[]
    capacityMeshEdges?: CapacityMeshEdge[]
  }) {
    super()
    this.allNodes = [...nodePortPoints]
    this.colorMap = colorMap ?? {}
    this.routes = []
    this.traceWidth = traceWidth
    this.viaDiameter = viaDiameter
    this.connMap = connMap
    this.hyperParameters = hyperParameters
    this.capacityMeshNodes = capacityMeshNodes
    this.capacityMeshEdges = capacityMeshEdges

    // Build lookup maps for capacity mesh data
    this.capacityMeshNodeMap = new Map(
      capacityMeshNodes.map((n) => [n.capacityMeshNodeId, n]),
    )
    this.nodeAdjacencyMap = this._buildNodeAdjacencyMap()

    this.nodesWithoutCrossings = []
    this.nodesWithCrossings = []
    this.nodeAnalyses = []
    this.curvyIntraNodeSolvers = []
    this.currentCurvySolverIndex = 0
    this.jumperSolvers = []
    this.currentJumperSolverIndex = 0
    this.phase = "analyzing"

    // Analyze nodes upfront
    this._analyzeNodes()

    // Calculate max iterations
    const curvyIterations = this.nodesWithoutCrossings.length * 1000
    const jumperIterations = this.nodesWithCrossings.length * 100000
    this.MAX_ITERATIONS = curvyIterations + jumperIterations + 100
  }

  /**
   * Build adjacency map from edges for quick lookup of adjacent nodes
   */
  _buildNodeAdjacencyMap(): Map<string, Set<string>> {
    const adjacencyMap = new Map<string, Set<string>>()
    for (const edge of this.capacityMeshEdges) {
      const [nodeId1, nodeId2] = edge.nodeIds
      if (!adjacencyMap.has(nodeId1)) {
        adjacencyMap.set(nodeId1, new Set())
      }
      if (!adjacencyMap.has(nodeId2)) {
        adjacencyMap.set(nodeId2, new Set())
      }
      adjacencyMap.get(nodeId1)!.add(nodeId2)
      adjacencyMap.get(nodeId2)!.add(nodeId1)
    }
    return adjacencyMap
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
      this.phase = "curvy"
      // Initialize curvy solvers for nodes without crossings
      this._initializeCurvySolvers()
    } else if (this.nodesWithCrossings.length > 0) {
      this.phase = "jumpers"
      // Initialize jumper solvers immediately since we're skipping curvy phase
      this._initializeJumperSolvers()
    } else {
      this.phase = "done"
    }
  }

  _step() {
    switch (this.phase) {
      case "analyzing":
        // Already done in constructor
        if (this.nodesWithoutCrossings.length > 0) {
          this.phase = "curvy"
          this._initializeCurvySolvers()
        } else if (this.nodesWithCrossings.length > 0) {
          this.phase = "jumpers"
          this._initializeJumperSolvers()
        } else {
          this.phase = "done"
        }
        break

      case "curvy":
        this._stepCurvySolvers()
        break

      case "jumpers":
        this._stepJumperSolvers()
        break

      case "done":
        this.solved = true
        break
    }
  }

  /**
   * Compute obstacles from adjacent nodes.
   * Uses the edge solver's adjacency information and only considers nodes
   * that contain obstacles or targets.
   *
   * Rules:
   * - Only adjacent nodes (from edges) are considered
   * - Only nodes with _containsObstacle or _containsTarget are obstacles
   * - If node contains obstacle but no target: no networkId
   * - If node contains target: networkId = _targetConnectionName (or from port points)
   */
  _getAdjacentObstacles(node: NodeWithPortPoints): AdjacentObstacle[] {
    const obstacles: AdjacentObstacle[] = []

    // Get adjacent node IDs from the edge-computed adjacency map
    const adjacentNodeIds = this.nodeAdjacencyMap.get(node.capacityMeshNodeId)
    if (!adjacentNodeIds || adjacentNodeIds.size === 0) {
      return obstacles
    }

    // Build a lookup for nodes with port points
    const nodeWithPortPointsMap = new Map(
      this.allNodes.map((n) => [n.capacityMeshNodeId, n]),
    )

    for (const adjacentNodeId of adjacentNodeIds) {
      const capacityNode = this.capacityMeshNodeMap.get(adjacentNodeId)
      if (!capacityNode) {
        continue
      }

      // Only consider nodes that contain obstacles or targets
      if (!capacityNode._containsObstacle && !capacityNode._containsTarget) {
        continue
      }

      const otherMinX = capacityNode.center.x - capacityNode.width / 2
      const otherMinY = capacityNode.center.y - capacityNode.height / 2
      const otherMaxX = capacityNode.center.x + capacityNode.width / 2
      const otherMaxY = capacityNode.center.y + capacityNode.height / 2

      // Determine networkId based on whether it contains a target
      let networkId: string | undefined
      if (capacityNode._containsTarget) {
        // Try to get from _targetConnectionName first
        if (capacityNode._targetConnectionName) {
          networkId = capacityNode._targetConnectionName
        } else {
          // Fall back to looking at port points if this node has them
          const adjacentNodeWithPorts =
            nodeWithPortPointsMap.get(adjacentNodeId)
          if (
            adjacentNodeWithPorts &&
            adjacentNodeWithPorts.portPoints.length > 0
          ) {
            // Use the rootConnectionName from the first port point
            networkId =
              adjacentNodeWithPorts.portPoints[0].rootConnectionName ??
              adjacentNodeWithPorts.portPoints[0].connectionName
          }
        }
      }
      // If it only contains an obstacle (no target), no networkId is assigned

      obstacles.push({
        minX: otherMinX,
        minY: otherMinY,
        maxX: otherMaxX,
        maxY: otherMaxY,
        networkId,
      })
    }

    return obstacles
  }

  /**
   * Initialize CurvyIntraNodeSolver for each node without crossings.
   * Each solver is created with adjacent obstacles from already-solved routes.
   */
  _initializeCurvySolvers() {
    // Create a solver for each node without crossings
    for (const node of this.nodesWithoutCrossings) {
      // Get adjacent obstacles from routes solved so far
      const adjacentObstacles = this._getAdjacentObstacles(node)

      const solver = new CurvyIntraNodeSolver({
        nodeWithPortPoints: node,
        colorMap: this.colorMap,
        traceWidth: this.traceWidth,
        viaDiameter: this.viaDiameter,
        adjacentObstacles,
      })
      this.curvyIntraNodeSolvers.push(solver)
    }
  }

  /**
   * Step through curvy solvers one at a time.
   * After each solver completes, its routes become obstacles for subsequent nodes.
   */
  _stepCurvySolvers() {
    if (this.curvyIntraNodeSolvers.length === 0) {
      this.phase = this.nodesWithCrossings.length > 0 ? "jumpers" : "done"
      if (this.phase === "jumpers") {
        this._initializeJumperSolvers()
      }
      return
    }

    const currentSolver =
      this.curvyIntraNodeSolvers[this.currentCurvySolverIndex]
    this.activeSubSolver = currentSolver
    if (!currentSolver) {
      this.phase = this.nodesWithCrossings.length > 0 ? "jumpers" : "done"
      if (this.phase === "jumpers") {
        this._initializeJumperSolvers()
      }
      return
    }

    currentSolver.step()

    if (currentSolver.solved) {
      // Collect routes from curvy solver
      this.routes.push(...currentSolver.routes)

      this.currentCurvySolverIndex++

      // Update adjacent obstacles for remaining solvers with newly solved routes
      for (
        let i = this.currentCurvySolverIndex;
        i < this.curvyIntraNodeSolvers.length;
        i++
      ) {
        const futureSolver = this.curvyIntraNodeSolvers[i]
        const node = this.nodesWithoutCrossings[i]
        const additionalObstacles = this._getAdjacentObstacles(node)

        // Merge additional obstacles into the solver's obstacles
        // Note: We re-initialize the solver with updated obstacles
        const newSolver = new CurvyIntraNodeSolver({
          nodeWithPortPoints: node,
          colorMap: this.colorMap,
          traceWidth: this.traceWidth,
          viaDiameter: this.viaDiameter,
          adjacentObstacles: additionalObstacles,
        })
        this.curvyIntraNodeSolvers[i] = newSolver
      }

      if (this.currentCurvySolverIndex >= this.curvyIntraNodeSolvers.length) {
        // Move to jumper phase
        this.phase = this.nodesWithCrossings.length > 0 ? "jumpers" : "done"
        if (this.phase === "jumpers") {
          this._initializeJumperSolvers()
        }
      }
    } else if (currentSolver.failed) {
      this.error = `CurvyIntraNodeSolver failed for node: ${currentSolver.nodeWithPortPoints.capacityMeshNodeId}: ${currentSolver.error}`
      this.failed = true
    }
  }

  _initializeJumperSolvers() {
    for (const node of this.nodesWithCrossings) {
      // Old solver (commented out):
      // const solver = new HyperIntraNodeSolverWithJumpers({
      //   nodeWithPortPoints: node,
      //   colorMap: this.colorMap,
      //   connMap: this.connMap,
      //   traceWidth: this.traceWidth,
      //   hyperParameters: {
      //     ...this.hyperParameters,
      //     FUTURE_CONNECTION_PROXIMITY_VD: 50,
      //     FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 1,
      //   },
      // })

      // HyperJumperPrepatternSolver2 tries multiple variants:
      // - single_1206x4 + vertical/horizontal
      // - 2x2_1206x4 + vertical/horizontal (if node >= 14mm)
      const solver = new HyperJumperPrepatternSolver2({
        nodeWithPortPoints: node,
        colorMap: this.colorMap,
        traceWidth: this.traceWidth,
        connMap: this.connMap,
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

      // Collect all jumpers from the solver (SRJ format with connectedTo populated)
      this.jumpers.push(...currentSolver.getOutputJumpers())

      this.currentJumperSolverIndex++

      if (this.currentJumperSolverIndex >= this.jumperSolvers.length) {
        this.phase = "done"
        this.solved = true
      }
    } else if (currentSolver.failed) {
      // Old error message (for HyperIntraNodeSolverWithJumpers):
      // this.error = `HyperIntraNodeSolverWithJumpers failed for node: ${currentSolver.nodeWithPortPoints.capacityMeshNodeId}: ${currentSolver.error}`
      // this.error = `JumperPrepatternSolver2_HyperGraph failed for node: ${currentSolver.nodeWithPortPoints.capacityMeshNodeId}: ${currentSolver.error}`
      this.error = `HyperJumperPrepatternSolver2 failed for node: ${currentSolver.nodeWithPortPoints.capacityMeshNodeId}: ${currentSolver.error}`
      this.failed = true
    }
  }

  computeProgress(): number {
    const totalNodes = this.allNodes.length
    if (totalNodes === 0) return 1

    let completedNodes = 0

    // Count completed from curvy solvers
    completedNodes += this.currentCurvySolverIndex

    // Add progress from current curvy solver
    const currentCurvySolver =
      this.curvyIntraNodeSolvers[this.currentCurvySolverIndex]
    if (currentCurvySolver) {
      completedNodes += currentCurvySolver.progress
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
      capacityMeshNodes: this.capacityMeshNodes,
      capacityMeshEdges: this.capacityMeshEdges,
    }
  }

  /**
   * Returns ALL jumpers collected from the jumper solvers.
   * These include all jumpers placed in the grid (from baseGraph.jumperLocations),
   * not just the ones used by routes. The pads have connectedTo set based on
   * which routes use each jumper.
   */
  getOutputJumpers(): SrjJumper[] {
    return this.jumpers
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // If failed, show the visualization of the failed solver
    if (this.failed && this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }

    // If currently running a sub-solver, show its visualization
    if (
      this.phase === "curvy" &&
      this.curvyIntraNodeSolvers[this.currentCurvySolverIndex]
    ) {
      return this.curvyIntraNodeSolvers[
        this.currentCurvySolverIndex
      ].visualize()
    }

    if (
      this.phase === "jumpers" &&
      this.jumperSolvers[this.currentJumperSolverIndex]
    ) {
      return this.jumperSolvers[this.currentJumperSolverIndex].visualize()
    }

    // Show completed routes
    for (const route of this.routes) {
      const colorKey = route.rootConnectionName ?? route.connectionName
      const mergedSegments = mergeRouteSegments(
        route.route,
        route.connectionName,
        this.colorMap[colorKey],
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
          fill: safeTransparentize(this.colorMap[colorKey] ?? "gray", 0.5),
          layer: "via",
        })
      }

      // Draw jumpers if present
      if ("jumpers" in route && route.jumpers) {
        for (const jumper of route.jumpers) {
          const color = this.colorMap[colorKey] ?? "gray"

          // Get dimensions based on jumper footprint (default to 1206 for hypergraph solver)
          const footprint = jumper.footprint ?? "1206"
          const dims = JUMPER_DIMENSIONS[footprint]

          // Determine jumper orientation to rotate pad dimensions
          const dx = jumper.end.x - jumper.start.x
          const dy = jumper.end.y - jumper.start.y
          const isHorizontal = Math.abs(dx) > Math.abs(dy)
          const rectWidth = isHorizontal ? dims.padLength : dims.padWidth
          const rectHeight = isHorizontal ? dims.padWidth : dims.padLength

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

          // Draw connecting line (jumper body)
          graphics.lines!.push({
            points: [jumper.start, jumper.end],
            strokeColor: "rgba(100, 100, 100, 0.8)",
            strokeWidth: dims.padWidth * 0.3,
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
