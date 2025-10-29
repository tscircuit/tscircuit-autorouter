import { CapacityPathingGreedySolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingGreedySolver"
import type { CapacityHyperParameters } from "lib/solvers/CapacityHyperParameters"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import {
  cloneAndShuffleArray,
  seededRandom,
} from "lib/utils/cloneAndShuffleArray"
import type {
  Candidate,
  CapacityPathingSolver,
} from "lib/solvers/CapacityPathingSolver/CapacityPathingSolver"
import { distance } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"

type CapacityPathingConstructorParams = ConstructorParameters<
  typeof CapacityPathingGreedySolver
>[0]

type AssignableViaCapacityHyperParameters = Partial<CapacityHyperParameters> & {
  SHUFFLE_SEED?: number

  DIRECTIVE_SEED?: number

  FORCE_VIA_TRAVEL_CHANCE?: number
  FAR_VIA_MIN_DISTANCE?: number
}

/**
 * This capacity path solver employs conditional directives. Whether or not the
 * directive applies depends on the pseudo-random hash of the DIRECTIVE_SEED
 *
 * The main conditional directive is whether or not to force the path to go
 * to go through a via then through a far via (if necessary to get to the goal
 * layer). This is useful because it prevents an early path from cutting off
 * all other paths.
 *
 * When forced to traverse via a via, you first select the closest "via" (a
 * via is a node that has availableZ: [0,1]) then a via close
 * to your first via that is a minimum of FAR_VIA_MIN_DISTANCE away. You sort
 * these candidate vias by the weighted sum of the distance to the first via and
 * the goal- seeking to minimize that total distance while staying FAR_VIA_MIN_DISTANCE
 * away from the first via.
 *
 * The visualize() function helps understand the algorithm as it runs by
 * highlighting the selected vias and the path currently being solved. Instead
 * of solving for a single path for a pair of nodes, we now have to solve for
 * multiple paths for multiple pairs of nodes (the middle nodes being the
 * forced vias)
 *
 */
type RouteSegment = {
  start: CapacityMeshNode
  end: CapacityMeshNode
}

export class AssignableViaCapacityPathingSolver_DirectiveSubOptimal extends CapacityPathingGreedySolver {
  GREEDY_MULTIPLIER = 1.5

  private get hyperParams(): AssignableViaCapacityHyperParameters {
    return this.hyperParameters as AssignableViaCapacityHyperParameters
  }

  // Multi-segment routing state
  private currentRouteSegments: RouteSegment[] = []
  private currentSegmentIndex = 0
  private segmentPaths: CapacityMeshNode[][] = []

  constructor(opts: CapacityPathingConstructorParams) {
    super(opts)
    this.applyTraceOrdering()
  }

  private applyTraceOrdering() {
    const seed = this.hyperParams.SHUFFLE_SEED
    if (seed === undefined) return
    this.connectionsWithNodes = cloneAndShuffleArray(
      this.connectionsWithNodes,
      seed,
    ) as typeof this.connectionsWithNodes
  }

  private isViaNode(node: CapacityMeshNode): boolean {
    return node.availableZ.length > 1
  }

  private shouldForceViaTravel(connectionIndex: number): boolean {
    const directiveSeed = this.hyperParams.DIRECTIVE_SEED
    const forceViaTravelChance = this.hyperParams.FORCE_VIA_TRAVEL_CHANCE ?? 0.5

    if (directiveSeed === undefined) return false

    const random = seededRandom(directiveSeed + connectionIndex)
    return random() < forceViaTravelChance
  }

  private findClosestVia(
    from: CapacityMeshNode,
    excludeIds: Set<CapacityMeshNodeId> = new Set(),
  ): CapacityMeshNode | null {
    let closestVia: CapacityMeshNode | null = null
    let minDistance = Number.MAX_VALUE

    for (const node of this.nodes) {
      if (excludeIds.has(node.capacityMeshNodeId)) continue
      if (!this.isViaNode(node)) continue

      const dist = distance(from.center, node.center)
      if (dist < minDistance) {
        minDistance = dist
        closestVia = node
      }
    }

    return closestVia
  }

  private findFarVia(
    from: CapacityMeshNode,
    firstVia: CapacityMeshNode,
    goal: CapacityMeshNode,
  ): CapacityMeshNode | null {
    const minDistance = this.hyperParams.FAR_VIA_MIN_DISTANCE ?? 1.0
    let bestVia: CapacityMeshNode | null = null
    let bestScore = Number.MAX_VALUE

    for (const node of this.nodes) {
      if (node.capacityMeshNodeId === firstVia.capacityMeshNodeId) continue
      if (!this.isViaNode(node)) continue

      const distToFirstVia = distance(node.center, firstVia.center)
      if (distToFirstVia < minDistance) continue

      // Weighted sum: distance to first via + distance to goal
      // We want to minimize this while staying far from first via
      const distToGoal = distance(node.center, goal.center)
      const score = distToFirstVia * 0.3 + distToGoal * 0.7

      if (score < bestScore) {
        bestScore = score
        bestVia = node
      }
    }

    return bestVia
  }

  private setupRouteSegments(start: CapacityMeshNode, end: CapacityMeshNode) {
    this.currentRouteSegments = []
    this.currentSegmentIndex = 0
    this.segmentPaths = []

    // Check if we should force via travel
    if (!this.shouldForceViaTravel(this.currentConnectionIndex)) {
      // Normal routing: just start to end
      this.currentRouteSegments = [{ start, end }]
      return
    }

    // Check if start and end need layer changes
    const startLayer = start.availableZ[0]
    const endLayer = end.availableZ[0]
    const needsLayerChange = startLayer !== endLayer

    if (!needsLayerChange) {
      // No layer change needed, use normal routing
      this.currentRouteSegments = [{ start, end }]
      return
    }

    // Find first via (closest to start)
    const firstVia = this.findClosestVia(start)
    if (!firstVia) {
      // No via found, use normal routing
      this.currentRouteSegments = [{ start, end }]
      return
    }

    // Find far via (far from first via, closer to goal)
    const farVia = this.findFarVia(start, firstVia, end)
    if (!farVia) {
      // No far via found, just use first via
      this.currentRouteSegments = [
        { start, end: firstVia },
        { start: firstVia, end },
      ]
      return
    }

    // Full routing: start -> first via -> far via -> end
    this.currentRouteSegments = [
      { start, end: firstVia },
      { start: firstVia, end: farVia },
      { start: farVia, end },
    ]
  }

  getTotalCapacity(node: CapacityMeshNode): number {
    return 0.5
  }

  doesNodeHaveCapacityForTrace(
    node: CapacityMeshNode,
    prevNode: CapacityMeshNode,
  ) {
    const usedCapacity =
      this.usedNodeCapacityMap.get(node.capacityMeshNodeId) ?? 0

    if (usedCapacity > 0) return false

    return true
  }

  computeG(
    prevCandidate: Parameters<CapacityPathingSolver["computeG"]>[0],
    node: Parameters<CapacityPathingSolver["computeG"]>[1],
    endGoal: Parameters<CapacityPathingSolver["computeG"]>[2],
  ) {
    // // If same layer as prev node, add penalty
    // let stepsSinceLayerChange = 0
    // const currentLayer = node.availableZ[0]
    // let prevCursor: Candidate | null = prevCandidate
    // while (prevCursor) {
    //   if (prevCursor.node.availableZ[0] === currentLayer) {
    //     stepsSinceLayerChange++
    //   } else {
    //     break
    //   }
    //   prevCursor = prevCursor.prevCandidate
    // }

    // const hasMultipleLayerChanges = Boolean(prevCursor?.prevCandidate)

    // const sameLayerPenalty = hasMultipleLayerChanges
    //   ? 0
    //   : stepsSinceLayerChange * 10

    // TODO HUGE penalty if the distance between the layer change is small-
    // this doesn't give a large enough gap for other traces to get through

    return super.computeG(prevCandidate, node, endGoal) // + sameLayerPenalty
  }

  computeH(
    prevCandidate: Parameters<CapacityPathingSolver["computeH"]>[0],
    node: Parameters<CapacityPathingSolver["computeH"]>[1],
    endGoal: Parameters<CapacityPathingSolver["computeH"]>[2],
  ) {
    return super.computeH(prevCandidate, node, endGoal)
  }

  _step() {
    const nextConnection =
      this.connectionsWithNodes[this.currentConnectionIndex]
    if (!nextConnection) {
      this.solved = true
      return
    }

    // Initialize route segments if starting a new connection
    if (!this.candidates) {
      const [start, end] = nextConnection.nodes
      this.setupRouteSegments(start, end)
      this.currentSegmentIndex = 0
      this.segmentPaths = []
    }

    // Get current segment
    const currentSegment = this.currentRouteSegments[this.currentSegmentIndex]
    if (!currentSegment) {
      // All segments complete, combine paths
      this.completeMultiSegmentRoute(nextConnection)
      return
    }

    // Initialize candidates for this segment if needed
    if (!this.candidates) {
      this.candidates = [
        {
          prevCandidate: null,
          node: currentSegment.start,
          f: 0,
          g: 0,
          h: 0,
        },
      ]
      this.debug_lastNodeCostMap = new Map()
      this.visitedNodes = new Set([currentSegment.start.capacityMeshNodeId])
      this.activeCandidateStraightLineDistance = distance(
        currentSegment.start.center,
        currentSegment.end.center,
      )
    }

    // Run A* pathfinding step
    this.candidates.sort((a, b) => a.f - b.f)
    const currentCandidate = this.candidates.shift()
    if (this.candidates.length > this.MAX_CANDIDATES_IN_MEMORY) {
      this.candidates.splice(
        this.MAX_CANDIDATES_IN_MEMORY,
        this.candidates.length - this.MAX_CANDIDATES_IN_MEMORY,
      )
    }
    if (!currentCandidate) {
      console.error(
        `Ran out of candidates on connection ${nextConnection.connection.name} segment ${this.currentSegmentIndex}`,
      )
      this.currentConnectionIndex++
      this.candidates = null
      this.visitedNodes = null
      this.currentRouteSegments = []
      this.currentSegmentIndex = 0
      this.segmentPaths = []
      this.failed = true
      return
    }

    // Check if reached end of current segment
    if (this.isConnectedToEndGoal(currentCandidate.node, currentSegment.end)) {
      const segmentPath = this.getBacktrackedPath({
        prevCandidate: currentCandidate,
        node: currentSegment.end,
        f: 0,
        g: 0,
        h: 0,
      })

      this.segmentPaths.push(segmentPath)

      // Move to next segment
      this.currentSegmentIndex++
      this.candidates = null
      this.visitedNodes = null
      return
    }

    // Continue A* for current segment
    const neighborNodes = this.getNeighboringNodes(currentCandidate.node)
    for (const neighborNode of neighborNodes) {
      if (this.visitedNodes?.has(neighborNode.capacityMeshNodeId)) {
        continue
      }
      if (
        !this.doesNodeHaveCapacityForTrace(neighborNode, currentCandidate.node)
      ) {
        continue
      }
      const connectionName =
        this.connectionsWithNodes[this.currentConnectionIndex].connection.name
      if (
        neighborNode._containsObstacle &&
        !this.canTravelThroughObstacle(neighborNode, connectionName)
      ) {
        continue
      }
      const g = this.computeG(
        currentCandidate,
        neighborNode,
        currentSegment.end,
      )
      const h = this.computeH(
        currentCandidate,
        neighborNode,
        currentSegment.end,
      )
      const f = g + h * this.GREEDY_MULTIPLIER

      this.debug_lastNodeCostMap.set(neighborNode.capacityMeshNodeId, {
        f,
        g,
        h,
      })

      const newCandidate = {
        prevCandidate: currentCandidate,
        node: neighborNode,
        f,
        g,
        h,
      }
      this.candidates.push(newCandidate)
    }
    this.visitedNodes!.add(currentCandidate.node.capacityMeshNodeId)
  }

  private completeMultiSegmentRoute(
    nextConnection: (typeof this.connectionsWithNodes)[0],
  ) {
    // Combine all segment paths into one
    const combinedPath: CapacityMeshNode[] = []
    for (let i = 0; i < this.segmentPaths.length; i++) {
      const segmentPath = this.segmentPaths[i]
      if (i === 0) {
        // First segment: add all nodes
        combinedPath.push(...segmentPath)
      } else {
        // Subsequent segments: skip first node (it's the last node of previous segment)
        combinedPath.push(...segmentPath.slice(1))
      }
    }

    nextConnection.path = combinedPath

    this.reduceCapacityAlongPath(nextConnection)

    this.currentConnectionIndex++
    this.candidates = null
    this.visitedNodes = null
    this.currentRouteSegments = []
    this.currentSegmentIndex = 0
    this.segmentPaths = []
  }

  visualize(): GraphicsObject {
    const graphics = super.visualize()

    // Highlight forced vias for current connection
    if (this.currentRouteSegments.length > 1) {
      // Multiple segments means we're using forced vias
      for (let i = 0; i < this.currentRouteSegments.length - 1; i++) {
        const via = this.currentRouteSegments[i].end
        graphics.circles!.push({
          center: { x: via.center.x, y: via.center.y },
          radius: via.width * 0.5,
          fill: i === 0 ? "rgba(255, 255, 0, 0.5)" : "rgba(255, 165, 0, 0.5)", // Yellow for first via, orange for far via
          stroke: i === 0 ? "yellow" : "orange",
          label: i === 0 ? "First Via" : "Far Via",
        })
      }
    }

    // Draw segment indicators
    if (this.currentRouteSegments.length > 0) {
      for (let i = 0; i <= this.currentSegmentIndex; i++) {
        if (i < this.currentRouteSegments.length) {
          const segment = this.currentRouteSegments[i]
          const isCurrentSegment = i === this.currentSegmentIndex
          graphics.lines!.push({
            points: [
              { x: segment.start.center.x, y: segment.start.center.y },
              { x: segment.end.center.x, y: segment.end.center.y },
            ],
            strokeColor: isCurrentSegment ? "yellow" : "green",
            strokeDash: isCurrentSegment ? "5 5" : "10 2",
          })
        }
      }
    }

    return graphics
  }

  getNodeCapacityPenalty(node: CapacityMeshNode): number {
    return 0
  }
}
