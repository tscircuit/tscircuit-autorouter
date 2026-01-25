import { BaseSolver } from "../BaseSolver"
import type {
  HighDensityIntraNodeRouteWithJumpers,
  Jumper,
} from "lib/types/high-density-types"
import {
  distance,
  pointToSegmentDistance,
  doSegmentsIntersect,
} from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import { HighDensityHyperParameters } from "./HighDensityHyperParameters"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  Node,
  SingleRouteCandidatePriorityQueue,
} from "lib/data-structures/SingleRouteCandidatePriorityQueue"

export type FutureConnection = {
  connectionName: string
  points: { x: number; y: number; z: number }[]
}

/**
 * 0603 footprint dimensions in mm
 * 0.8mm x 0.95mm pads, 1.65mm center-to-center
 */
const JUMPER_0603 = {
  length: 1.8, // mm (center-to-center distance)
  width: 0.95, // mm (perpendicular to jumper direction)
  padLength: 0.8, // mm (pad at each end)
  padWidth: 0.95, // mm
}

/**
 * Components that make up the g (cost so far) calculation
 */
type GComponents = {
  /** Total path distance traveled from start */
  distFromStart: number
  /** Cumulative weighted penalty for being near obstacles */
  weightedMmNearObstacle: number
  /** Cumulative weighted penalty for being near edges */
  weightedMmNearEdge: number
  /** Cumulative weighted penalty for being near future connection start/end points */
  weightedMmNearFutureConnectionStartEnd: number
  /** Cumulative weighted penalty for being near future connection lines */
  weightedMmNearFutureConnectionLine: number
  /** Cumulative jumper penalty (includes jumper distance + penalty factor) */
  jumperPenalty: number
  /** Cumulative penalty for jumper pads near future connections */
  jumperPadFutureConnectionPenalty: number
  /** Total g value (sum of all components) */
  total: number
}

/**
 * Components that make up the h (heuristic) calculation
 */
type HComponents = {
  distanceToGoal: number
  obstacleProximity: number
  edgeProximity: number
  futureConnectionStartEndProximityPenalty: number
  futureConnectionLine: number
  total: number
  /** Stored rates (penalty per mm) for derivative computation */
  obstacleProximityRate: number
  edgeProximityRate: number
  futureConnectionStartEndProximityRate: number
  futureConnectionLineRate: number
}

/**
 * Extended node type that tracks jumper usage
 */
type JumperNode = Node & {
  /** If this node was reached via a jumper, this contains jumper info */
  jumperEntry?: { x: number; y: number }
  /** Track if this movement is the exit of a jumper */
  isJumperExit?: boolean
  /** Count of jumpers used to reach this node */
  jumperCount?: number
  /** Stored g components for debugging/visualization */
  gComponents?: GComponents
  /** Stored h components for debugging/visualization */
  hComponents?: HComponents
}

export class SingleHighDensityRouteWithJumpersSolver extends BaseSolver {
  override getSolverName(): string {
    return "SingleHighDensityRouteWithJumpersSolver"
  }

  obstacleRoutes: HighDensityIntraNodeRouteWithJumpers[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  boundsSize: { width: number; height: number }
  boundsCenter: { x: number; y: number }
  A: { x: number; y: number; z: number }
  B: { x: number; y: number; z: number }
  roundedGoalPosition: { x: number; y: number; z: number }
  straightLineDistance: number

  traceThickness: number
  obstacleMargin: number
  minCellSize = 0.05
  cellStep = 0.05
  GREEDY_MULTIPLER = 1.1
  numRoutes: number

  /** Penalty factor for using a jumper (relative to distance) */
  JUMPER_PENALTY_FACTOR: number

  /** Future connection proximity parameters */
  FUTURE_CONNECTION_START_END_PENALTY: number
  FUTURE_CONNECTION_START_END_PROXIMITY: number

  /** Future connection jumper pad penalty parameters */
  FUTURE_CONNECTION_JUMPER_PAD_PROXIMITY: number
  FUTURE_CONNECTION_JUMPER_PAD_PENALTY: number

  /** Jumper-to-jumper pad proximity penalty parameters */
  JUMPER_JUMPER_PAD_PROXIMITY: number
  JUMPER_JUMPER_PAD_PENALTY: number

  /** Future connection line proximity penalty parameters */
  FUTURE_CONNECTION_LINE_PROXIMITY: number
  FUTURE_CONNECTION_LINE_PENALTY: number

  /** Obstacle proximity penalty parameters (repulsive field) */
  OBSTACLE_PROX_PENALTY_FACTOR: number
  OBSTACLE_PROX_SIGMA: number

  /** Edge proximity penalty parameters */
  EDGE_PROX_PENALTY_FACTOR: number
  EDGE_PROX_SIGMA: number

  /** Whether to allow diagonal movement in pathfinding */
  ALLOW_DIAGONAL: boolean

  /** Minimum distance traveled before allowing jumper neighbors */
  MIN_TRAVEL_BEFORE_JUMPER: number

  CELL_SIZE_FACTOR: number

  exploredNodes: Set<string>

  candidates: SingleRouteCandidatePriorityQueue<JumperNode>

  connectionName: string
  rootConnectionName?: string
  solvedPath: HighDensityIntraNodeRouteWithJumpers | null = null

  futureConnections: FutureConnection[]
  hyperParameters: Partial<HighDensityHyperParameters>

  connMap?: ConnectivityMap

  /** For debugging/animating the exploration */
  debug_exploredNodesOrdered: string[]
  debug_exploredNodeValues: Map<
    string,
    {
      g: number
      h: number
      f: number
      gComponents?: GComponents
      hComponents?: HComponents
    }
  >
  debug_nodesTooCloseToObstacle: Set<string>
  debug_nodePathToParentIntersectsObstacle: Set<string>

  debugEnabled = true

  initialNodeGridOffset: { x: number; y: number }

  /** Existing jumpers that act as obstacles */
  existingJumpers: Jumper[]

  constructor(opts: {
    connectionName: string
    rootConnectionName?: string
    obstacleRoutes: HighDensityIntraNodeRouteWithJumpers[]
    minDistBetweenEnteringPoints: number
    bounds: { minX: number; maxX: number; minY: number; maxY: number }
    A: { x: number; y: number; z: number }
    B: { x: number; y: number; z: number }
    traceThickness?: number
    obstacleMargin?: number
    futureConnections?: FutureConnection[]
    hyperParameters?: Partial<HighDensityHyperParameters>
    connMap?: ConnectivityMap
  }) {
    super()
    this.bounds = opts.bounds
    this.connMap = opts.connMap
    this.hyperParameters = opts.hyperParameters ?? {}

    const diagonalNodeSize = Math.sqrt(
      (opts.bounds.maxX - opts.bounds.minX) ** 2 +
        (opts.bounds.maxY - opts.bounds.minY) ** 2,
    )

    this.CELL_SIZE_FACTOR = this.hyperParameters.CELL_SIZE_FACTOR ?? 1
    this.JUMPER_PENALTY_FACTOR = 0.2
    this.FUTURE_CONNECTION_START_END_PROXIMITY ??= 8
    this.FUTURE_CONNECTION_START_END_PENALTY ??= 3

    // Initialize future connection jumper pad penalty parameters
    this.FUTURE_CONNECTION_JUMPER_PAD_PROXIMITY =
      this.hyperParameters.FUTURE_CONNECTION_JUMPER_PAD_PROXIMITY ??
      diagonalNodeSize / 4
    this.FUTURE_CONNECTION_JUMPER_PAD_PENALTY =
      this.hyperParameters.FUTURE_CONNECTION_JUMPER_PAD_PENALTY ?? 1000

    // Initialize jumper-to-jumper pad penalty parameters
    this.JUMPER_JUMPER_PAD_PROXIMITY =
      this.hyperParameters.JUMPER_JUMPER_PAD_PROXIMITY ?? 5
    this.JUMPER_JUMPER_PAD_PENALTY =
      this.hyperParameters.JUMPER_JUMPER_PAD_PENALTY ?? 0

    // Initialize future connection line penalty parameters
    this.FUTURE_CONNECTION_LINE_PROXIMITY =
      this.hyperParameters.FUTURE_CONNECTION_LINE_PROXIMITY ?? 10
    this.FUTURE_CONNECTION_LINE_PENALTY =
      this.hyperParameters.FUTURE_CONNECTION_LINE_PENALTY ?? 5

    // Initialize obstacle proximity penalty parameters
    // These are "soft" penalties that prefer high-clearance paths but don't block routes
    this.OBSTACLE_PROX_PENALTY_FACTOR =
      this.hyperParameters.OBSTACLE_PROX_PENALTY_FACTOR ?? 2
    this.OBSTACLE_PROX_SIGMA = this.hyperParameters.OBSTACLE_PROX_SIGMA ?? 2

    // Initialize edge proximity penalty parameters
    // Keep lower than obstacle penalty since edges are less problematic than trace collisions
    // and to avoid issues in tight spaces where start/end points are near edges
    this.EDGE_PROX_PENALTY_FACTOR =
      this.hyperParameters.EDGE_PROX_PENALTY_FACTOR ?? 1
    this.EDGE_PROX_SIGMA = this.hyperParameters.EDGE_PROX_SIGMA ?? 1

    // Initialize diagonal movement setting
    this.ALLOW_DIAGONAL = this.hyperParameters.ALLOW_DIAGONAL ?? true

    // Minimum travel before allowing jumpers
    this.MIN_TRAVEL_BEFORE_JUMPER ??= 3

    this.boundsSize = {
      width: this.bounds.maxX - this.bounds.minX,
      height: this.bounds.maxY - this.bounds.minY,
    }
    this.boundsCenter = {
      x: (this.bounds.minX + this.bounds.maxX) / 2,
      y: (this.bounds.minY + this.bounds.maxY) / 2,
    }
    this.connectionName = opts.connectionName
    this.rootConnectionName = opts.rootConnectionName
    this.obstacleRoutes = opts.obstacleRoutes
    this.A = { ...opts.A, z: 0 } // Single layer, always z=0
    this.B = { ...opts.B, z: 0 } // Single layer, always z=0
    this.traceThickness = opts.traceThickness ?? 0.15
    this.obstacleMargin = opts.obstacleMargin ?? 0.2
    this.exploredNodes = new Set()
    this.straightLineDistance = distance(this.A, this.B)
    this.futureConnections = opts.futureConnections ?? []
    this.MAX_ITERATIONS = 10e3

    this.debug_exploredNodesOrdered = []
    this.debug_exploredNodeValues = new Map()
    this.debug_nodesTooCloseToObstacle = new Set()
    this.debug_nodePathToParentIntersectsObstacle = new Set()
    this.numRoutes = this.obstacleRoutes.length + this.futureConnections.length

    // Collect all existing jumpers from obstacle routes
    this.existingJumpers = []
    for (const route of this.obstacleRoutes) {
      if (route.jumpers) {
        this.existingJumpers.push(...route.jumpers)
      }
    }

    const bestRowOrColumnCount = Math.ceil(5 * (this.numRoutes + 1))
    let numXCells = this.boundsSize.width / this.cellStep
    let numYCells = this.boundsSize.height / this.cellStep

    while (numXCells * numYCells > bestRowOrColumnCount ** 2) {
      if (this.cellStep > opts.minDistBetweenEnteringPoints) {
        break
      }
      this.cellStep *= 2
      numXCells = this.boundsSize.width / this.cellStep
      numYCells = this.boundsSize.height / this.cellStep
    }

    this.cellStep *= this.CELL_SIZE_FACTOR

    const isOnSameEdge =
      (Math.abs(this.A.x - this.bounds.minX) < 0.001 &&
        Math.abs(this.B.x - this.bounds.minX) < 0.001) ||
      (Math.abs(this.A.x - this.bounds.maxX) < 0.001 &&
        Math.abs(this.B.x - this.bounds.maxX) < 0.001) ||
      (Math.abs(this.A.y - this.bounds.minY) < 0.001 &&
        Math.abs(this.B.y - this.bounds.minY) < 0.001) ||
      (Math.abs(this.A.y - this.bounds.maxY) < 0.001 &&
        Math.abs(this.B.y - this.bounds.maxY) < 0.001)

    if (
      this.futureConnections &&
      this.futureConnections.length === 0 &&
      this.obstacleRoutes.length === 0 &&
      !isOnSameEdge
    ) {
      this.handleSimpleCases()
    }

    const initialNodePosition = {
      x: opts.A.x,
      y: opts.A.y,
    }
    this.initialNodeGridOffset = {
      x:
        initialNodePosition.x -
        Math.round(opts.A.x / this.cellStep) * this.cellStep,
      y:
        initialNodePosition.y -
        Math.round(opts.A.y / this.cellStep) * this.cellStep,
    }
    this.roundedGoalPosition = {
      x: Math.round(opts.B.x / this.cellStep) * this.cellStep,
      y: Math.round(opts.B.y / this.cellStep) * this.cellStep,
      z: 0,
    }
    const initialGComponents: GComponents = {
      distFromStart: 0,
      weightedMmNearObstacle: 0,
      weightedMmNearEdge: 0,
      weightedMmNearFutureConnectionStartEnd: 0,
      weightedMmNearFutureConnectionLine: 0,
      jumperPenalty: 0,
      jumperPadFutureConnectionPenalty: 0,
      total: 0,
    }
    const initialHComponents: HComponents = {
      distanceToGoal: 0,
      obstacleProximity: 0,
      edgeProximity: 0,
      futureConnectionStartEndProximityPenalty: 0,
      futureConnectionLine: 0,
      total: 0,
      obstacleProximityRate: 0,
      edgeProximityRate: 0,
      futureConnectionStartEndProximityRate: 0,
      futureConnectionLineRate: 0,
    }
    this.candidates = new SingleRouteCandidatePriorityQueue([
      {
        ...opts.A,
        ...initialNodePosition,
        z: 0,
        g: 0,
        h: 0,
        f: 0,
        jumperCount: 0,
        gComponents: initialGComponents,
        hComponents: initialHComponents,
        parent: {
          ...opts.A,
          z: 0,
          g: 0,
          h: 0,
          f: 0,
          gComponents: initialGComponents,
          hComponents: initialHComponents,
          parent: null,
        },
      },
    ])
  }

  handleSimpleCases() {
    this.solved = true
    const { A, B } = this
    this.solvedPath = {
      connectionName: this.connectionName,
      rootConnectionName: this.rootConnectionName,
      route: [
        { x: A.x, y: A.y, z: 0 },
        { x: B.x, y: B.y, z: 0 },
      ],
      traceThickness: this.traceThickness,
      jumpers: [],
    }
  }

  get jumperPenaltyDistance() {
    return (
      JUMPER_0603.length +
      this.straightLineDistance * this.JUMPER_PENALTY_FACTOR
    )
  }

  /**
   * Check if a node is too close to an obstacle trace or jumper
   */
  isNodeTooCloseToObstacle(node: JumperNode, margin?: number) {
    margin ??= this.obstacleMargin

    // Check against obstacle routes
    for (const route of this.obstacleRoutes) {
      const connectedToObstacle = this.connMap?.areIdsConnected?.(
        this.connectionName,
        route.connectionName,
      )

      if (!connectedToObstacle) {
        const pointPairs = getSameLayerPointPairs(route)
        for (const pointPair of pointPairs) {
          if (
            pointToSegmentDistance(node, pointPair.A, pointPair.B) <
            this.traceThickness + margin
          ) {
            return true
          }
        }
      }

      // Check against jumpers in this route
      for (const jumper of route.jumpers || []) {
        if (this.isNodeTooCloseToJumper(node, jumper, margin)) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Check if a node is too close to a jumper's pads
   * Traces CAN route under the body of the jumper, just not under the pads
   */
  isNodeTooCloseToJumper(
    node: { x: number; y: number },
    jumper: Jumper,
    margin: number,
  ): boolean {
    const dx = jumper.end.x - jumper.start.x
    const dy = jumper.end.y - jumper.start.y

    // Determine if jumper is horizontal or vertical for pad dimensions
    const isHorizontal = Math.abs(dx) > Math.abs(dy)
    const padHalfWidth =
      (isHorizontal ? JUMPER_0603.padLength : JUMPER_0603.padWidth) / 2 + margin
    const padHalfHeight =
      (isHorizontal ? JUMPER_0603.padWidth : JUMPER_0603.padLength) / 2 + margin

    // Check against start pad
    if (
      Math.abs(node.x - jumper.start.x) < padHalfWidth &&
      Math.abs(node.y - jumper.start.y) < padHalfHeight
    ) {
      return true
    }

    // Check against end pad
    if (
      Math.abs(node.x - jumper.end.x) < padHalfWidth &&
      Math.abs(node.y - jumper.end.y) < padHalfHeight
    ) {
      return true
    }

    return false
  }

  isNodeTooCloseToEdge(node: JumperNode) {
    const margin =
      (node.gComponents?.distFromStart ?? 0 < this.obstacleMargin / 2)
        ? -this.obstacleMargin / 2
        : this.obstacleMargin / 2
    const tooClose =
      node.x < this.bounds.minX + margin ||
      node.x > this.bounds.maxX - margin ||
      node.y < this.bounds.minY + margin ||
      node.y > this.bounds.maxY - margin
    if (tooClose) {
      if (
        distance(node, this.B) < margin * 2 ||
        distance(node, this.A) < margin * 2
      ) {
        return false
      }
    }
    return tooClose
  }

  doesPathToParentIntersectObstacle(node: JumperNode) {
    const parent = node.parent
    if (!parent) return false

    for (const route of this.obstacleRoutes) {
      const obstacleIsConnectedToNewPath = this.connMap?.areIdsConnected?.(
        this.connectionName,
        route.connectionName,
      )
      if (obstacleIsConnectedToNewPath) continue

      for (const pointPair of getSameLayerPointPairs(route)) {
        if (doSegmentsIntersect(node, parent, pointPair.A, pointPair.B)) {
          return true
        }
      }

      // Check if path crosses any jumper pads (but can pass under jumper body)
      for (const jumper of route.jumpers || []) {
        if (this.doesSegmentIntersectJumperPads(node, parent, jumper)) {
          return true
        }
      }
    }
    return false
  }

  /**
   * Check if a line segment intersects with a jumper's pads
   * Segments CAN pass under the jumper body, just not through the pads
   */
  doesSegmentIntersectJumperPads(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    jumper: Jumper,
  ): boolean {
    const margin = this.obstacleMargin
    const dx = jumper.end.x - jumper.start.x
    const dy = jumper.end.y - jumper.start.y

    // Determine if jumper is horizontal or vertical for pad dimensions
    const isHorizontal = Math.abs(dx) > Math.abs(dy)
    const padHalfWidth =
      (isHorizontal ? JUMPER_0603.padLength : JUMPER_0603.padWidth) / 2 + margin
    const padHalfHeight =
      (isHorizontal ? JUMPER_0603.padWidth : JUMPER_0603.padLength) / 2 + margin

    // Check intersection with start pad
    if (
      this.doesSegmentIntersectRect(
        p1,
        p2,
        jumper.start,
        padHalfWidth,
        padHalfHeight,
      )
    ) {
      return true
    }

    // Check intersection with end pad
    if (
      this.doesSegmentIntersectRect(
        p1,
        p2,
        jumper.end,
        padHalfWidth,
        padHalfHeight,
      )
    ) {
      return true
    }

    return false
  }

  /**
   * Check if a line segment intersects with an axis-aligned rectangle
   */
  doesSegmentIntersectRect(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    center: { x: number; y: number },
    halfWidth: number,
    halfHeight: number,
  ): boolean {
    const minX = center.x - halfWidth
    const maxX = center.x + halfWidth
    const minY = center.y - halfHeight
    const maxY = center.y + halfHeight

    // Check if either endpoint is inside the rectangle
    if (p1.x >= minX && p1.x <= maxX && p1.y >= minY && p1.y <= maxY)
      return true
    if (p2.x >= minX && p2.x <= maxX && p2.y >= minY && p2.y <= maxY)
      return true

    // Check if line segment intersects any of the rectangle's edges
    const rectEdges = [
      { A: { x: minX, y: minY }, B: { x: maxX, y: minY } }, // bottom
      { A: { x: maxX, y: minY }, B: { x: maxX, y: maxY } }, // right
      { A: { x: maxX, y: maxY }, B: { x: minX, y: maxY } }, // top
      { A: { x: minX, y: maxY }, B: { x: minX, y: minY } }, // left
    ]

    for (const edge of rectEdges) {
      if (doSegmentsIntersect(p1, p2, edge.A, edge.B)) {
        return true
      }
    }

    return false
  }

  /**
   * Find obstacles between current node and a target position
   * Returns the obstacle segment(s) that block the direct path
   */
  findObstaclesBetween(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Array<{ A: { x: number; y: number }; B: { x: number; y: number } }> {
    const obstacles: Array<{
      A: { x: number; y: number }
      B: { x: number; y: number }
    }> = []

    for (const route of this.obstacleRoutes) {
      const obstacleIsConnectedToNewPath = this.connMap?.areIdsConnected?.(
        this.connectionName,
        route.connectionName,
      )
      if (obstacleIsConnectedToNewPath) continue

      for (const pointPair of getSameLayerPointPairs(route)) {
        if (doSegmentsIntersect(from, to, pointPair.A, pointPair.B)) {
          obstacles.push({ A: pointPair.A, B: pointPair.B })
        }
      }
    }

    return obstacles
  }

  computeHComponents(node: JumperNode): HComponents {
    const goalDist = distance(node, this.roundedGoalPosition)

    // Get current penalty rates (per mm)
    const obstacleProximityRate = this.getObstacleProximityPenalty(node)
    const edgeProximityRate = this.getEdgeProximityPenalty(node)
    const futureConnectionStartEndProximityRate =
      this.getFutureConnectionStartEndPenalty(node)
    const futureConnectionLineRate = this.getFutureConnectionLinePenalty(node)

    // Get parent's rates and compute step distance for derivative calculation
    const parent = node.parent as JumperNode | null
    const parentHComponents = parent?.hComponents
    const stepDist = parent ? distance(node, parent) : 0

    // Compute expected average rates based on derivative (rate of change)
    // If rate is decreasing, we expect lower average over remaining distance
    // If rate is increasing, we expect higher average
    const computeExpectedAvgRate = (
      currentRate: number,
      parentRate: number | undefined,
    ): number => {
      if (parentRate === undefined || stepDist < 1e-9 || goalDist < 1e-9) {
        // No derivative info available, use current rate
        return currentRate
      }

      // Compute derivative: how much the rate changes per mm traveled
      const rateDerivative = (currentRate - parentRate) / stepDist

      // Project rate at goal (clamped to >= 0)
      const projectedGoalRate = Math.max(
        0,
        currentRate + rateDerivative * goalDist,
      )

      // Expected average rate is midpoint between current and projected goal rate
      return (currentRate + projectedGoalRate) / 2
    }

    const avgObstacleRate = computeExpectedAvgRate(
      obstacleProximityRate,
      parentHComponents?.obstacleProximityRate,
    )
    const avgEdgeRate = computeExpectedAvgRate(
      edgeProximityRate,
      parentHComponents?.edgeProximityRate,
    )
    const avgFutureConnectionRate = computeExpectedAvgRate(
      futureConnectionStartEndProximityRate,
      parentHComponents?.futureConnectionStartEndProximityRate,
    )
    const avgFutureConnectionLineRate = computeExpectedAvgRate(
      futureConnectionLineRate,
      parentHComponents?.futureConnectionLineRate,
    )

    // Estimate remaining penalties using expected average rates
    const obstacleProximity = avgObstacleRate * goalDist
    const edgeProximity = avgEdgeRate * goalDist
    const futureConnectionStartEndProximityPenalty =
      avgFutureConnectionRate * goalDist
    const futureConnectionLine = avgFutureConnectionLineRate * goalDist

    const total =
      goalDist +
      obstacleProximity +
      edgeProximity +
      futureConnectionStartEndProximityPenalty +
      futureConnectionLine
    return {
      distanceToGoal: goalDist,
      obstacleProximity,
      edgeProximity,
      futureConnectionStartEndProximityPenalty,
      futureConnectionLine,
      total,
      // Store current rates for derivative computation in child nodes
      obstacleProximityRate,
      edgeProximityRate,
      futureConnectionStartEndProximityRate,
      futureConnectionLineRate,
    }
  }

  computeH(node: JumperNode) {
    return this.computeHComponents(node).total
  }

  computeGComponents(node: JumperNode): GComponents {
    const parent = node.parent as JumperNode | null
    const stepDist = parent ? distance(node, parent) : 0

    // Get parent's g components (or zeros if no parent)
    const parentGComponents = parent?.gComponents ?? {
      distFromStart: 0,
      weightedMmNearObstacle: 0,
      weightedMmNearEdge: 0,
      weightedMmNearFutureConnectionStartEnd: 0,
      weightedMmNearFutureConnectionLine: 0,
      jumperPenalty: 0,
      jumperPadFutureConnectionPenalty: 0,
      total: 0,
    }

    // Compute cumulative distance from start
    const distFromStart = parentGComponents.distFromStart + stepDist

    // Compute cumulative weighted penalties (penalty rate * step distance)
    const weightedMmNearObstacle =
      parentGComponents.weightedMmNearObstacle +
      this.getObstacleProximityPenalty(node) * stepDist

    const weightedMmNearEdge =
      parentGComponents.weightedMmNearEdge +
      this.getEdgeProximityPenalty(node) * stepDist

    const weightedMmNearFutureConnectionStartEnd =
      parentGComponents.weightedMmNearFutureConnectionStartEnd +
      this.getFutureConnectionStartEndPenalty(node) * stepDist

    const weightedMmNearFutureConnectionLine =
      parentGComponents.weightedMmNearFutureConnectionLine +
      this.getFutureConnectionLinePenalty(node) * stepDist

    // Jumper penalties
    let jumperPenalty = parentGComponents.jumperPenalty
    let jumperPadFutureConnectionPenalty =
      parentGComponents.jumperPadFutureConnectionPenalty

    if (node.isJumperExit) {
      jumperPenalty += this.jumperPenaltyDistance
      jumperPadFutureConnectionPenalty +=
        this.getJumperPadFutureConnectionPenalty(node)
    }

    const total =
      distFromStart +
      weightedMmNearObstacle +
      weightedMmNearEdge +
      weightedMmNearFutureConnectionStartEnd +
      weightedMmNearFutureConnectionLine +
      jumperPenalty +
      jumperPadFutureConnectionPenalty

    return {
      distFromStart,
      weightedMmNearObstacle,
      weightedMmNearEdge,
      weightedMmNearFutureConnectionStartEnd,
      weightedMmNearFutureConnectionLine,
      jumperPenalty,
      jumperPadFutureConnectionPenalty,
      total,
    }
  }

  computeG(node: JumperNode) {
    return this.computeGComponents(node).total
  }

  computeF(g: number, h: number) {
    return g + h * this.GREEDY_MULTIPLER
  }

  getClosestFutureConnectionPoint(node: JumperNode) {
    let minDist = Infinity
    let closestPoint = null

    for (const futureConnection of this.futureConnections) {
      for (const point of futureConnection.points) {
        const dist = distance(node, point)
        if (dist < minDist) {
          minDist = dist
          closestPoint = point
        }
      }
    }

    return closestPoint
  }

  getFutureConnectionStartEndPenalty(node: JumperNode) {
    let futureConnectionPenalty = 0
    const closestFuturePoint = this.getClosestFutureConnectionPoint(node)
    if (closestFuturePoint) {
      const distToFuturePoint = distance(node, closestFuturePoint)
      if (distToFuturePoint > this.FUTURE_CONNECTION_START_END_PROXIMITY)
        return 0
      const distRatio =
        distToFuturePoint / this.FUTURE_CONNECTION_START_END_PROXIMITY
      futureConnectionPenalty =
        this.FUTURE_CONNECTION_START_END_PENALTY * (1 - distRatio) ** 2
    }
    return futureConnectionPenalty
  }

  /**
   * Calculate penalty for being close to future connection line segments.
   * This penalty is computed by summing the segment-to-point distance between
   * the node and all unrouted future connection start-to-end segments.
   * The penalty helps routes avoid crossing directly over future connection paths.
   */
  getFutureConnectionLinePenalty(node: JumperNode): number {
    if (this.futureConnections.length === 0) {
      return 0
    }

    let closestLineDist = Infinity
    const closeGoalFactor =
      Math.min(
        1,
        (node.hComponents?.distanceToGoal ?? 0) /
          this.FUTURE_CONNECTION_LINE_PROXIMITY,
      ) ** 2

    for (const futureConnection of this.futureConnections) {
      if (futureConnection.points.length < 2) continue

      // Get the start and end points of the future connection
      const start = futureConnection.points[0]
      const end = futureConnection.points[futureConnection.points.length - 1]

      const distToLine = pointToSegmentDistance(node, start, end)
      closestLineDist = Math.min(closestLineDist, distToLine)
    }

    closestLineDist *= closeGoalFactor

    // Apply penalty if within proximity threshold
    if (closestLineDist < this.FUTURE_CONNECTION_LINE_PROXIMITY) {
      const distRatio = Math.max(
        0.1,
        closestLineDist / this.FUTURE_CONNECTION_LINE_PROXIMITY,
      )
      // Penalty is higher when closer to the line
      return this.FUTURE_CONNECTION_LINE_PENALTY * (1 - distRatio) ** 2
    }

    return 0
  }

  /**
   * Calculate penalty for jumper pads placed near future connection start/end points.
   * This disincentivizes placing jumper pads in areas that will be needed for future routing.
   * The distance is calculated as the minimum distance from either jumper pad to any future connection point.
   */
  getJumperPadFutureConnectionPenalty(node: JumperNode): number {
    // Only apply to jumper exits
    if (!node.isJumperExit || !node.jumperEntry) {
      return 0
    }

    const startPad = node.jumperEntry // The entry point (start pad)
    const endPad = { x: node.x, y: node.y } // The current node (end pad)

    let minDistToFutureConnection = Infinity

    // Find the minimum distance from either pad to any future connection start/end point
    for (const futureConnection of this.futureConnections) {
      for (const point of futureConnection.points) {
        const distFromStartPad = distance(startPad, point)
        const distFromEndPad = distance(endPad, point)
        const minDistFromPads = Math.min(distFromStartPad, distFromEndPad)
        minDistToFutureConnection = Math.min(
          minDistToFutureConnection,
          minDistFromPads,
        )
      }
    }

    // Apply penalty if within proximity threshold
    if (
      minDistToFutureConnection < this.FUTURE_CONNECTION_JUMPER_PAD_PROXIMITY
    ) {
      const distRatio =
        minDistToFutureConnection / this.FUTURE_CONNECTION_JUMPER_PAD_PROXIMITY
      // Penalty is higher when closer to future connection points
      return this.FUTURE_CONNECTION_JUMPER_PAD_PENALTY * (1 - distRatio)
    }

    return 0
  }

  /**
   * Compute the minimum distance from a node to any obstacle (trace segments and jumper pads)
   */
  getClearanceToObstacles(node: { x: number; y: number }): number {
    let minD = Infinity

    for (const route of this.obstacleRoutes) {
      const connected = this.connMap?.areIdsConnected?.(
        this.connectionName,
        route.connectionName,
      )
      if (connected) continue

      // Check distance to trace segments
      for (const seg of getSameLayerPointPairs(route)) {
        minD = Math.min(minD, pointToSegmentDistance(node, seg.A, seg.B))
      }

      // Jumper pads are solid obstacles
      for (const j of route.jumpers || []) {
        minD = Math.min(minD, this.distanceToJumperPads(node, j))
      }
    }

    return minD
  }

  /**
   * Compute distance from a point to the nearest jumper pad
   */
  distanceToJumperPads(p: { x: number; y: number }, j: Jumper): number {
    const dx = j.end.x - j.start.x
    const dy = j.end.y - j.start.y
    const isHorizontal = Math.abs(dx) > Math.abs(dy)

    const padHalfW =
      (isHorizontal ? JUMPER_0603.padLength : JUMPER_0603.padWidth) / 2
    const padHalfH =
      (isHorizontal ? JUMPER_0603.padWidth : JUMPER_0603.padLength) / 2

    return Math.min(
      this.pointToRectDistance(p, j.start, padHalfW, padHalfH),
      this.pointToRectDistance(p, j.end, padHalfW, padHalfH),
    )
  }

  /**
   * Compute distance from a point to an axis-aligned rectangle (0 if inside)
   */
  pointToRectDistance(
    p: { x: number; y: number },
    c: { x: number; y: number },
    halfW: number,
    halfH: number,
  ): number {
    const dx = Math.max(Math.abs(p.x - c.x) - halfW, 0)
    const dy = Math.max(Math.abs(p.y - c.y) - halfH, 0)
    return Math.hypot(dx, dy)
  }

  /**
   * Compute minimum distance from a node to the nearest boundary edge
   */
  getClearanceToEdge(node: { x: number; y: number }): number {
    return Math.min(
      node.x - this.bounds.minX,
      this.bounds.maxX - node.x,
      node.y - this.bounds.minY,
      this.bounds.maxY - node.y,
    )
  }

  /**
   * Compute the obstacle proximity penalty (repulsive field)
   * Returns a high value near obstacles, ~0 far away
   */
  getObstacleProximityPenalty(node: JumperNode): number {
    const c = this.getClearanceToObstacles(node)

    // Treat "effective clearance" relative to trace thickness + margin
    const effective = Math.max(
      0,
      c - (this.traceThickness + this.obstacleMargin),
    )

    // Repulsive potential: big near obstacles, tiny far away
    const sigma = this.OBSTACLE_PROX_SIGMA
    return this.OBSTACLE_PROX_PENALTY_FACTOR * Math.exp(-effective / sigma)
  }

  /**
   * Compute the edge proximity penalty (repulsive field near boundaries)
   * Returns a high value near edges, ~0 far away
   * Penalty is reduced as we approach the goal (which is always on an edge)
   */
  getEdgeProximityPenalty(node: JumperNode): number {
    const c = this.getClearanceToEdge(node)
    const sigma = this.EDGE_PROX_SIGMA

    if (c > this.EDGE_PROX_SIGMA * 2) {
      return 0
    }

    // Reduce penalty as we get closer to the goal (goal is always on an edge)
    const goalDist = distance(node, this.B)
    const goalProximityFactor = Math.min(
      1,
      goalDist / (this.EDGE_PROX_SIGMA * 2),
    )

    return (
      this.EDGE_PROX_PENALTY_FACTOR * Math.exp(-c / sigma) * goalProximityFactor
    )
  }

  getNodeKey(node: JumperNode) {
    const jumperSuffix = node.isJumperExit ? "_j" : ""
    return `${Math.round(node.x / this.cellStep) * this.cellStep},${Math.round(node.y / this.cellStep) * this.cellStep},${node.z}${jumperSuffix}`
  }

  /**
   * Calculate potential jumper positions to cross an obstacle
   */
  getJumperNeighbors(node: JumperNode): JumperNode[] {
    const neighbors: JumperNode[] = []

    // Don't allow jumpers until we've traveled a minimum distance
    const distFromStart = node.gComponents?.distFromStart ?? 0
    if (distFromStart < this.MIN_TRAVEL_BEFORE_JUMPER) {
      return neighbors
    }

    // Look for obstacles in horizontal and vertical directions only
    // (jumpers must be arranged horizontally or vertically)
    const directions = [
      { dx: 1, dy: 0 }, // right (horizontal)
      { dx: -1, dy: 0 }, // left (horizontal)
      { dx: 0, dy: 1 }, // up (vertical)
      { dx: 0, dy: -1 }, // down (vertical)
    ]

    for (const dir of directions) {
      // Check if there's an obstacle in this direction within jumper range
      const checkDist = JUMPER_0603.length * 2
      const targetX = node.x + dir.dx * checkDist
      const targetY = node.y + dir.dy * checkDist

      const obstacles = this.findObstaclesBetween(node, {
        x: targetX,
        y: targetY,
      })

      if (obstacles.length > 0) {
        // Calculate a jumper position that would clear the obstacle
        for (const obstacle of obstacles) {
          const jumperNeighbor = this.calculateJumperExit(node, obstacle, dir)
          if (
            jumperNeighbor &&
            !this.exploredNodes.has(this.getNodeKey(jumperNeighbor))
          ) {
            // Verify the jumper exit is valid
            if (
              !this.isNodeTooCloseToObstacle(jumperNeighbor) &&
              !this.isNodeTooCloseToEdge(jumperNeighbor) &&
              this.isJumperPlacementValid(node, jumperNeighbor)
            ) {
              jumperNeighbor.gComponents =
                this.computeGComponents(jumperNeighbor)
              jumperNeighbor.hComponents =
                this.computeHComponents(jumperNeighbor)
              jumperNeighbor.g = jumperNeighbor.gComponents.total
              jumperNeighbor.h = jumperNeighbor.hComponents.total
              jumperNeighbor.f = this.computeF(
                jumperNeighbor.g,
                jumperNeighbor.h,
              )
              neighbors.push(jumperNeighbor)
            }
          }
        }
      }
    }

    return neighbors
  }

  /**
   * Calculate the exit position for a jumper that clears an obstacle
   */
  calculateJumperExit(
    entry: JumperNode,
    obstacle: { A: { x: number; y: number }; B: { x: number; y: number } },
    direction: { dx: number; dy: number },
  ): JumperNode | null {
    // Calculate the jumper length needed to clear the obstacle
    const jumpDistance = JUMPER_0603.length

    // Normalize direction
    const dirLength = Math.sqrt(
      direction.dx * direction.dx + direction.dy * direction.dy,
    )
    const normDx = direction.dx / dirLength
    const normDy = direction.dy / dirLength

    // Calculate exit position
    const exitX = entry.x + normDx * jumpDistance
    const exitY = entry.y + normDy * jumpDistance

    // Check bounds
    if (
      exitX < this.bounds.minX ||
      exitX > this.bounds.maxX ||
      exitY < this.bounds.minY ||
      exitY > this.bounds.maxY
    ) {
      return null
    }

    return {
      x: exitX,
      y: exitY,
      z: 0,
      parent: entry,
      g: 0,
      h: 0,
      f: 0,
      jumperEntry: { x: entry.x, y: entry.y },
      isJumperExit: true,
      jumperCount: (entry.jumperCount ?? 0) + 1,
    }
  }

  /**
   * Check if a jumper's pads are too close to obstacle traces
   */
  isJumperTooCloseToTraces(
    entry: { x: number; y: number },
    exit: { x: number; y: number },
  ): boolean {
    const dx = exit.x - entry.x
    const dy = exit.y - entry.y
    const isHorizontal = Math.abs(dx) > Math.abs(dy)

    // Get pad dimensions based on jumper orientation
    const padHalfWidth =
      (isHorizontal ? JUMPER_0603.padLength : JUMPER_0603.padWidth) / 2
    const padHalfHeight =
      (isHorizontal ? JUMPER_0603.padWidth : JUMPER_0603.padLength) / 2
    const margin = this.obstacleMargin

    // Check both entry and exit pad positions against all obstacle traces
    const padCenters = [entry, exit]

    for (const padCenter of padCenters) {
      // Check each corner and edge midpoint of the pad for proximity to traces
      const checkPoints = [
        padCenter, // center
        { x: padCenter.x - padHalfWidth, y: padCenter.y - padHalfHeight }, // corners
        { x: padCenter.x + padHalfWidth, y: padCenter.y - padHalfHeight },
        { x: padCenter.x - padHalfWidth, y: padCenter.y + padHalfHeight },
        { x: padCenter.x + padHalfWidth, y: padCenter.y + padHalfHeight },
        { x: padCenter.x - padHalfWidth, y: padCenter.y }, // edge midpoints
        { x: padCenter.x + padHalfWidth, y: padCenter.y },
        { x: padCenter.x, y: padCenter.y - padHalfHeight },
        { x: padCenter.x, y: padCenter.y + padHalfHeight },
      ]

      for (const route of this.obstacleRoutes) {
        const connectedToObstacle = this.connMap?.areIdsConnected?.(
          this.connectionName,
          route.connectionName,
        )
        if (connectedToObstacle) continue

        const pointPairs = getSameLayerPointPairs(route)
        for (const pointPair of pointPairs) {
          // Check if any check point is too close to the trace segment
          for (const checkPoint of checkPoints) {
            if (
              pointToSegmentDistance(checkPoint, pointPair.A, pointPair.B) <
              this.traceThickness + margin
            ) {
              return true
            }
          }

          // Also check if the trace segment passes through the pad rectangle
          if (
            this.doesSegmentIntersectRect(
              pointPair.A,
              pointPair.B,
              padCenter,
              padHalfWidth + margin,
              padHalfHeight + margin,
            )
          ) {
            return true
          }
        }
      }
    }

    return false
  }

  /**
   * Verify that a jumper placement is valid (doesn't overlap with existing jumpers or traces)
   */
  isJumperPlacementValid(entry: JumperNode, exit: JumperNode): boolean {
    // Check that jumper pads aren't too close to existing traces
    if (this.isJumperTooCloseToTraces(entry, exit)) {
      return false
    }

    // Check that the jumper doesn't overlap with existing jumpers
    const proposedJumper: Jumper = {
      route_type: "jumper",
      start: { x: entry.x, y: entry.y },
      end: { x: exit.x, y: exit.y },
      footprint: "0603",
    }

    for (const existingJumper of this.existingJumpers) {
      if (this.doJumpersOverlap(proposedJumper, existingJumper)) {
        return false
      }
    }

    // Also check jumpers in the current path
    const pathJumpers = this.getJumpersInPath(entry)
    for (const pathJumper of pathJumpers) {
      if (this.doJumpersOverlap(proposedJumper, pathJumper)) {
        return false
      }
    }

    return true
  }

  /**
   * Check if two jumpers overlap
   */
  doJumpersOverlap(j1: Jumper, j2: Jumper): boolean {
    const margin = this.obstacleMargin

    // Simple bounding box check
    const j1MinX =
      Math.min(j1.start.x, j1.end.x) - JUMPER_0603.width / 2 - margin
    const j1MaxX =
      Math.max(j1.start.x, j1.end.x) + JUMPER_0603.width / 2 + margin
    const j1MinY =
      Math.min(j1.start.y, j1.end.y) - JUMPER_0603.width / 2 - margin
    const j1MaxY =
      Math.max(j1.start.y, j1.end.y) + JUMPER_0603.width / 2 + margin

    const j2MinX =
      Math.min(j2.start.x, j2.end.x) - JUMPER_0603.width / 2 - margin
    const j2MaxX =
      Math.max(j2.start.x, j2.end.x) + JUMPER_0603.width / 2 + margin
    const j2MinY =
      Math.min(j2.start.y, j2.end.y) - JUMPER_0603.width / 2 - margin
    const j2MaxY =
      Math.max(j2.start.y, j2.end.y) + JUMPER_0603.width / 2 + margin

    return !(
      j1MaxX < j2MinX ||
      j1MinX > j2MaxX ||
      j1MaxY < j2MinY ||
      j1MinY > j2MaxY
    )
  }

  /**
   * Get all jumpers in the path to a node
   */
  getJumpersInPath(node: JumperNode): Jumper[] {
    const jumpers: Jumper[] = []
    let current: JumperNode | null = node

    while (current && current.parent) {
      if (current.isJumperExit && current.jumperEntry) {
        jumpers.push({
          route_type: "jumper",
          start: current.jumperEntry,
          end: { x: current.x, y: current.y },
          footprint: "0603",
        })
      }
      current = current.parent as JumperNode
    }

    return jumpers
  }

  getNeighbors(node: JumperNode): JumperNode[] {
    const neighbors: JumperNode[] = []

    const { maxX, minX, maxY, minY } = this.bounds

    // Regular grid neighbors
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        if (x === 0 && y === 0) continue

        // Skip diagonal moves if not allowed
        if (!this.ALLOW_DIAGONAL && x !== 0 && y !== 0) continue

        const rawX = node.x + x * this.cellStep
        const rawY = node.y + y * this.cellStep
        const clampedX = clamp(rawX, minX, maxX)
        const clampedY = clamp(rawY, minY, maxY)

        const neighbor: JumperNode = {
          ...node,
          parent: node,
          x: clampedX,
          y: clampedY,
          isJumperExit: false,
          jumperEntry: undefined,
          jumperCount: node.jumperCount ?? 0,
        }

        const neighborKey = this.getNodeKey(neighbor)

        if (this.exploredNodes.has(neighborKey)) {
          continue
        }

        if (this.isNodeTooCloseToObstacle(neighbor)) {
          this.debug_nodesTooCloseToObstacle.add(neighborKey)
          this.exploredNodes.add(neighborKey)
          continue
        }

        if (this.isNodeTooCloseToEdge(neighbor)) {
          this.debug_nodesTooCloseToObstacle.add(neighborKey)
          continue
        }

        if (this.doesPathToParentIntersectObstacle(neighbor)) {
          this.debug_nodePathToParentIntersectsObstacle.add(neighborKey)
          this.exploredNodes.add(neighborKey)
          continue
        }

        neighbor.gComponents = this.computeGComponents(neighbor)
        neighbor.hComponents = this.computeHComponents(neighbor)
        neighbor.g = neighbor.gComponents.total
        neighbor.h = neighbor.hComponents.total
        neighbor.f = this.computeF(neighbor.g, neighbor.h)

        neighbors.push(neighbor)
      }
    }

    // Add jumper neighbors if there are obstacles nearby
    const jumperNeighbors = this.getJumperNeighbors(node)
    neighbors.push(...jumperNeighbors)

    return neighbors
  }

  getNodePath(node: JumperNode): JumperNode[] {
    const path: JumperNode[] = []
    let current: JumperNode | null = node
    while (current) {
      path.push(current)
      current = current.parent as JumperNode | null
    }
    return path
  }

  setSolvedPath(node: JumperNode) {
    const path = this.getNodePath(node)
    path.reverse()

    const jumpers: Jumper[] = []
    for (let i = 0; i < path.length; i++) {
      const pathNode = path[i]
      if (pathNode.isJumperExit && pathNode.jumperEntry) {
        jumpers.push({
          route_type: "jumper",
          start: pathNode.jumperEntry,
          end: { x: pathNode.x, y: pathNode.y },
          footprint: "0603",
        })
      }
    }

    this.solvedPath = {
      connectionName: this.connectionName,
      rootConnectionName: this.rootConnectionName,
      traceThickness: this.traceThickness,
      route: path
        .map((n) => ({ x: n.x, y: n.y, z: 0 }))
        .concat([{ x: this.B.x, y: this.B.y, z: 0 }]),
      jumpers,
    }
  }

  computeProgress(currentNode: JumperNode, goalDist: number) {
    const goalDistPercent = 1 - goalDist / this.straightLineDistance

    return Math.max(
      this.progress || 0,
      (2 / Math.PI) *
        Math.atan((0.112 * goalDistPercent) / (1 - goalDistPercent)),
    )
  }

  _step() {
    let currentNode = this.candidates.dequeue() as JumperNode | null
    let currentNodeKey = currentNode ? this.getNodeKey(currentNode) : undefined

    while (
      currentNode &&
      currentNodeKey &&
      this.exploredNodes.has(currentNodeKey)
    ) {
      currentNode = this.candidates.dequeue() as JumperNode | null
      currentNodeKey = currentNode ? this.getNodeKey(currentNode) : undefined
    }

    if (!currentNode || !currentNodeKey) {
      this.failed = true
      this.error = "Ran out of candidate nodes to explore"
      return
    }
    this.exploredNodes.add(currentNodeKey)
    this.debug_exploredNodesOrdered.push(currentNodeKey)
    this.debug_exploredNodeValues.set(currentNodeKey, {
      g: currentNode.g,
      h: currentNode.h,
      f: currentNode.f,
      gComponents: currentNode.gComponents,
      hComponents: currentNode.hComponents,
    })

    const goalDist = distance(currentNode, this.roundedGoalPosition)

    this.progress = this.computeProgress(currentNode, goalDist)

    if (
      goalDist <= this.cellStep * Math.SQRT2 &&
      !this.doesPathToParentIntersectObstacle({
        ...currentNode,
        parent: currentNode,
        x: this.B.x,
        y: this.B.y,
      } as JumperNode)
    ) {
      this.solved = true
      this.setSolvedPath(currentNode)
    }

    const neighbors = this.getNeighbors(currentNode)
    for (const neighbor of neighbors) {
      this.candidates.enqueue(neighbor)
    }
  }

  /**
   * Draw the two pads of an 0603 jumper
   * Pad dimensions are rotated based on jumper orientation
   */
  private drawJumperPads(
    graphics: GraphicsObject,
    jumper: Jumper,
    color: string,
    layer?: string,
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
      layer: layer ?? "jumper",
      step,
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
      layer: layer ?? "jumper",
      step,
    })

    // Draw a line connecting the pads (representing the jumper body)
    graphics.lines!.push({
      points: [jumper.start, jumper.end],
      strokeColor: "rgba(100, 100, 100, 0.8)",
      strokeWidth: padWidth * 0.3,
      layer: layer ?? "jumper-body",
      step,
    })
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Display the input port points
    graphics.points!.push({
      x: this.A.x,
      y: this.A.y,
      label: `Input A\nz: ${this.A.z}`,
      color: "orange",
    })
    graphics.points!.push({
      x: this.B.x,
      y: this.B.y,
      label: `Input B\nz: ${this.B.z}`,
      color: "orange",
    })

    // Draw a line representing the direct connection
    graphics.lines!.push({
      points: [this.A, this.B],
      strokeColor: "rgba(255, 0, 0, 0.5)",
      label: "Direct Input Connection",
    })

    // Show obstacle routes
    for (
      let routeIndex = 0;
      routeIndex < this.obstacleRoutes.length;
      routeIndex++
    ) {
      const route = this.obstacleRoutes[routeIndex]
      for (let i = 0; i < route.route.length - 1; i++) {
        graphics.lines!.push({
          points: [route.route[i], route.route[i + 1]],
          strokeColor: "rgba(255, 0, 0, 0.75)",
          strokeWidth: route.traceThickness,
          label: "Obstacle Route",
          layer: `obstacle${routeIndex.toString()}`,
        })
      }

      // Draw obstacle jumpers
      for (const jumper of route.jumpers || []) {
        this.drawJumperPads(
          graphics,
          jumper,
          "rgba(255, 0, 0, 0.5)",
          `obstacle-jumper-${routeIndex}`,
        )
      }
    }

    // Show future connections as blue lines from start to end
    for (let i = 0; i < this.futureConnections.length; i++) {
      const fc = this.futureConnections[i]
      if (fc.points.length < 2) continue
      const start = fc.points[0]
      const end = fc.points[fc.points.length - 1]
      graphics.lines!.push({
        points: [start, end],
        strokeColor: "rgba(0, 100, 255, 0.6)",
        strokeWidth: this.traceThickness,
        label: `Future: ${fc.connectionName}`,
        layer: `future-connection-${i}`,
      })
    }

    // Visualize explored nodes
    for (let i = 0; i < this.debug_exploredNodesOrdered.length; i++) {
      const nodeKey = this.debug_exploredNodesOrdered[i]
      if (this.debug_nodesTooCloseToObstacle.has(nodeKey)) continue
      if (this.debug_nodePathToParentIntersectsObstacle.has(nodeKey)) continue

      const [x, y] = nodeKey.split(",").map(Number)
      const isJumperNode = nodeKey.endsWith("_j")

      const nodeValues = this.debug_exploredNodeValues.get(nodeKey)
      const gComp = nodeValues?.gComponents
      const hComp = nodeValues?.hComponents

      const goalDist = hComp?.distanceToGoal ?? 0
      const labelParts = [isJumperNode ? "Explored (jumper)" : "Explored"]

      // G components
      labelParts.push(
        `g.distFromStart: ${gComp?.distFromStart.toFixed(2) ?? "?"}`,
      )
      labelParts.push(
        `g.nearObstacle: ${gComp?.weightedMmNearObstacle.toFixed(2) ?? "?"}`,
      )
      labelParts.push(
        `g.nearEdge: ${gComp?.weightedMmNearEdge.toFixed(2) ?? "?"}`,
      )
      labelParts.push(
        `g.nearFutStrtEnd: ${gComp?.weightedMmNearFutureConnectionStartEnd.toFixed(2) ?? "?"}`,
      )
      labelParts.push(
        `g.nearFutLine: ${gComp?.weightedMmNearFutureConnectionLine.toFixed(2) ?? "?"}`,
      )
      labelParts.push(`g.jumper: ${gComp?.jumperPenalty.toFixed(2) ?? "?"}`)
      labelParts.push(
        `g.jumperPadFutPenalty: ${gComp?.jumperPadFutureConnectionPenalty.toFixed(2) ?? "?"}`,
      )

      // H components
      labelParts.push(`h.goalDist: ${goalDist.toFixed(2)}`)
      labelParts.push(
        `h.obstacleProx: ${hComp?.obstacleProximity.toFixed(2) ?? "?"} (${goalDist > 0 ? ((hComp?.obstacleProximity ?? 0) / goalDist).toFixed(3) : 0}/mm)`,
      )
      labelParts.push(
        `h.edgeProx: ${hComp?.edgeProximity.toFixed(2) ?? "?"} (${goalDist > 0 ? ((hComp?.edgeProximity ?? 0) / goalDist).toFixed(3) : 0}/mm)`,
      )
      labelParts.push(
        `h.futureConnPt: ${hComp?.futureConnectionStartEndProximityPenalty.toFixed(2) ?? "?"} (${goalDist > 0 ? ((hComp?.futureConnectionStartEndProximityPenalty ?? 0) / goalDist).toFixed(3) : 0}/mm)`,
      )
      labelParts.push(
        `h.futureConnLine: ${hComp?.futureConnectionLine.toFixed(2) ?? "?"} (${goalDist > 0 ? ((hComp?.futureConnectionLine ?? 0) / goalDist).toFixed(3) : 0}/mm)`,
      )
      labelParts.push(`g: ${nodeValues?.g.toFixed(2) ?? "?"}`)
      labelParts.push(`h: ${nodeValues?.h.toFixed(2) ?? "?"}`)
      labelParts.push(`f: ${nodeValues?.f.toFixed(2) ?? "?"}`)

      const label = labelParts.join("\n")

      graphics.rects!.push({
        center: {
          x: x + this.initialNodeGridOffset.x,
          y: y + this.initialNodeGridOffset.y,
        },
        fill: isJumperNode
          ? `rgba(0,255,255,${0.4 - (i / this.debug_exploredNodesOrdered.length) * 0.3})`
          : `rgba(255,0,255,${0.3 - (i / this.debug_exploredNodesOrdered.length) * 0.2})`,
        width: this.cellStep * 0.9,
        height: this.cellStep * 0.9,
        label,
      })
    }

    // Visualize the next node to be explored
    if (this.candidates.peek()) {
      const nextNode = this.candidates.peek()!
      graphics.rects!.push({
        center: {
          x: nextNode.x,
          y: nextNode.y,
        },
        fill: "rgba(0, 255, 0, 0.8)",
        width: this.cellStep * 0.9,
        height: this.cellStep * 0.9,
        label: "Next",
      })
    }

    // Visualize top 5 candidates with gray points
    const topCandidates = this.candidates.getTopN(5)
    for (let i = 0; i < topCandidates.length; i++) {
      const candidate = topCandidates[i] as JumperNode
      const isJumperNode = candidate.isJumperExit ?? false
      const gComp = candidate.gComponents
      const hComp = candidate.hComponents
      const goalDist = hComp?.distanceToGoal ?? 0

      const labelParts = [
        `Candidate #${i + 1}${isJumperNode ? " (jumper)" : ""}`,
      ]

      // G components
      labelParts.push(
        `g.distFromStart: ${gComp?.distFromStart.toFixed(2) ?? "?"}`,
      )
      labelParts.push(
        `g.nearObstacle: ${gComp?.weightedMmNearObstacle.toFixed(2) ?? "?"}`,
      )
      labelParts.push(
        `g.nearEdge: ${gComp?.weightedMmNearEdge.toFixed(2) ?? "?"}`,
      )
      labelParts.push(
        `g.nearFutureConnPt: ${gComp?.weightedMmNearFutureConnectionStartEnd.toFixed(2) ?? "?"}`,
      )
      labelParts.push(
        `g.nearFutureConnLine: ${gComp?.weightedMmNearFutureConnectionLine.toFixed(2) ?? "?"}`,
      )
      labelParts.push(`g.jumper: ${gComp?.jumperPenalty.toFixed(2) ?? "?"}`)
      labelParts.push(
        `g.jumperPadFutureConn: ${gComp?.jumperPadFutureConnectionPenalty.toFixed(2) ?? "?"}`,
      )
      labelParts.push(`g: ${candidate.g.toFixed(2)}`)

      // H components
      labelParts.push(`h.goalDist: ${goalDist.toFixed(2)}`)
      labelParts.push(
        `h.obstacleProx: ${hComp?.obstacleProximity.toFixed(2) ?? "?"} (${goalDist > 0 ? ((hComp?.obstacleProximity ?? 0) / goalDist).toFixed(3) : 0}/mm)`,
      )
      labelParts.push(
        `h.edgeProx: ${hComp?.edgeProximity.toFixed(2) ?? "?"} (${goalDist > 0 ? ((hComp?.edgeProximity ?? 0) / goalDist).toFixed(3) : 0}/mm)`,
      )
      labelParts.push(
        `h.futureConnPt: ${hComp?.futureConnectionStartEndProximityPenalty.toFixed(2) ?? "?"} (${goalDist > 0 ? ((hComp?.futureConnectionStartEndProximityPenalty ?? 0) / goalDist).toFixed(3) : 0}/mm)`,
      )
      labelParts.push(
        `h.futureConnLine: ${hComp?.futureConnectionLine.toFixed(2) ?? "?"} (${goalDist > 0 ? ((hComp?.futureConnectionLine ?? 0) / goalDist).toFixed(3) : 0}/mm)`,
      )
      labelParts.push(`h: ${candidate.h.toFixed(2)}`)
      labelParts.push(`f: ${candidate.f.toFixed(2)}`)

      const label = labelParts.join("\n")

      graphics.points!.push({
        x: candidate.x,
        y: candidate.y,
        color: "gray",
        label,
      })
    }

    // If a solved route exists, display it
    if (this.solvedPath) {
      graphics.lines!.push({
        points: this.solvedPath.route,
        strokeColor: "green",
        label: "Solved Route",
        strokeWidth: this.traceThickness,
      })

      // Draw solved jumpers
      for (const jumper of this.solvedPath.jumpers) {
        this.drawJumperPads(
          graphics,
          jumper,
          "rgba(0, 200, 0, 0.8)",
          "solved-jumper",
        )
      }
    }

    // Draw border around the bounds
    const { minX, minY, maxX, maxY } = this.bounds

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

function getSameLayerPointPairs(route: HighDensityIntraNodeRouteWithJumpers) {
  const pointPairs: {
    z: number
    A: { x: number; y: number; z: number }
    B: { x: number; y: number; z: number }
  }[] = []

  for (let i = 0; i < route.route.length - 1; i++) {
    if (route.route[i].z === route.route[i + 1].z) {
      const A = route.route[i]
      const B = route.route[i + 1]

      // Check if this segment is covered by a jumper
      // If so, skip it because the actual connection is elevated via the jumper
      // and traces can pass underneath
      const isCoveredByJumper = route.jumpers?.some((jumper) => {
        const matchesForward =
          Math.abs(jumper.start.x - A.x) < 0.001 &&
          Math.abs(jumper.start.y - A.y) < 0.001 &&
          Math.abs(jumper.end.x - B.x) < 0.001 &&
          Math.abs(jumper.end.y - B.y) < 0.001
        const matchesReverse =
          Math.abs(jumper.start.x - B.x) < 0.001 &&
          Math.abs(jumper.start.y - B.y) < 0.001 &&
          Math.abs(jumper.end.x - A.x) < 0.001 &&
          Math.abs(jumper.end.y - A.y) < 0.001
        return matchesForward || matchesReverse
      })

      if (!isCoveredByJumper) {
        pointPairs.push({
          z: A.z,
          A,
          B,
        })
      }
    }
  }

  return pointPairs
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}
