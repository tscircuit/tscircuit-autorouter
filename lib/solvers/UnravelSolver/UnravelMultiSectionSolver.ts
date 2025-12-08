import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1"
import { SegmentWithAssignedPoints } from "../CapacityMeshSolver/CapacitySegmentToPointSolver"
import { UnravelSectionSolver } from "./UnravelSectionSolver"
import { CachedUnravelSectionSolver } from "./CachedUnravelSectionSolver"
import { getIntraNodeCrossings } from "lib/utils/getIntraNodeCrossings"
import { NodePortSegment } from "lib/types/capacity-edges-to-port-segments-types"
import { getDedupedSegments } from "./getDedupedSegments"
import { getIntraNodeCrossingsFromSegments } from "lib/utils/getIntraNodeCrossingsFromSegments"
import { calculateNodeProbabilityOfFailure } from "./calculateCrossingProbabilityOfFailure"
import { BaseSolver } from "../BaseSolver"
import { GraphicsObject } from "graphics-debug"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import {
  PointModificationsMap,
  SegmentId,
  SegmentPoint,
  SegmentPointId,
  SegmentPointMap,
} from "./types"
import { createSegmentPointMap } from "./createSegmentPointMap"
import { getIntraNodeCrossingsFromSegmentPoints } from "lib/utils/getIntraNodeCrossingsFromSegmentPoints"
import { getNodesNearNode } from "./getNodesNearNode"
import { CacheProvider } from "lib/cache/types"
import { doSegmentsIntersect, distance } from "@tscircuit/math-utils"

export class UnravelMultiSectionSolver extends BaseSolver {
  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  dedupedSegmentMap: Map<SegmentId, SegmentWithAssignedPoints>
  dedupedSegments: SegmentWithAssignedPoints[]
  nodeIdToSegmentIds: Map<CapacityMeshNodeId, CapacityMeshNodeId[]>
  segmentIdToNodeIds: Map<CapacityMeshNodeId, CapacityMeshNodeId[]>
  nodeToSegmentPointMap: Map<CapacityMeshNodeId, SegmentPointId[]>
  segmentToSegmentPointMap: Map<SegmentId, SegmentPointId[]>
  colorMap: Record<string, string>
  tunedNodeCapacityMap: Map<CapacityMeshNodeId, number>

  MAX_NODE_ATTEMPTS = 2

  MUTABLE_HOPS = 1

  ACCEPTABLE_PF = 0.05

  MAX_ITERATIONS_WITHOUT_IMPROVEMENT = 200

  /**
   * Probability of failure for each node
   */
  nodePfMap: Map<CapacityMeshNodeId, number>

  attemptsToFixNode: Map<CapacityMeshNodeId, number>

  activeSubSolver: UnravelSectionSolver | null = null

  segmentPointMap: SegmentPointMap

  cacheProvider: CacheProvider | null = null

  constructor({
    assignedSegments,
    colorMap,
    nodes,
    cacheProvider,
  }: {
    assignedSegments: NodePortSegment[]
    colorMap?: Record<string, string>
    /**
     * This isn't used by the algorithm, but allows associating metadata
     * for the result datatype (the center, width, height of the node)
     */
    nodes: CapacityMeshNode[]
    cacheProvider?: CacheProvider | null
  }) {
    super()

    this.stats.successfulOptimizations = 0
    this.stats.failedOptimizations = 0
    this.stats.cacheHits = 0
    this.stats.cacheMisses = 0

    this.cacheProvider = cacheProvider ?? null

    this.MAX_ITERATIONS = 1e6

    this.dedupedSegments = getDedupedSegments(assignedSegments)
    this.dedupedSegmentMap = new Map()
    for (const segment of this.dedupedSegments) {
      this.dedupedSegmentMap.set(segment.nodePortSegmentId!, segment)
    }
    this.nodeMap = new Map()
    for (const node of nodes) {
      this.nodeMap.set(node.capacityMeshNodeId, node)
    }

    this.nodeIdToSegmentIds = new Map()
    this.segmentIdToNodeIds = new Map()
    this.attemptsToFixNode = new Map()

    for (const segment of assignedSegments) {
      this.segmentIdToNodeIds.set(segment.nodePortSegmentId!, [
        ...(this.segmentIdToNodeIds.get(segment.nodePortSegmentId!) ?? []),
        segment.capacityMeshNodeId,
      ])
      this.nodeIdToSegmentIds.set(segment.capacityMeshNodeId, [
        ...(this.nodeIdToSegmentIds.get(segment.capacityMeshNodeId) ?? []),
        segment.nodePortSegmentId!,
      ])
    }

    this.colorMap = colorMap ?? {}

    // Compute tuned capacity for each node
    this.tunedNodeCapacityMap = new Map()
    for (const [nodeId, node] of this.nodeMap) {
      this.tunedNodeCapacityMap.set(nodeId, getTunedTotalCapacity1(node))
    }

    const { segmentPointMap, nodeToSegmentPointMap, segmentToSegmentPointMap } =
      createSegmentPointMap(this.dedupedSegments, this.segmentIdToNodeIds)

    this.segmentPointMap = segmentPointMap
    this.nodeToSegmentPointMap = nodeToSegmentPointMap
    this.segmentToSegmentPointMap = segmentToSegmentPointMap

    // NOTE: Global layer optimization disabled - it can create vias at shared segments
    // Instead, rely on section-based processing with larger sections
    // this.optimizeMLCPConnectionLayers()

    this.nodePfMap = this.computeInitialPfMap()
  }

  /**
   * Optimize layer assignments for connections where all segment points
   * support multiple layers (MLCP connections). Uses graph coloring to
   * assign different layers to crossing connections.
   */
  optimizeMLCPConnectionLayers() {
    // Group segment points by connection name
    const connectionSegmentPoints = new Map<string, SegmentPoint[]>()
    for (const sp of this.segmentPointMap.values()) {
      if (!connectionSegmentPoints.has(sp.connectionName)) {
        connectionSegmentPoints.set(sp.connectionName, [])
      }
      connectionSegmentPoints.get(sp.connectionName)!.push(sp)
    }

    // For each connection, check if all segments support multiple layers
    const mlcpConnections: string[] = []
    const connectionAvailableZ = new Map<string, number[]>()

    for (const [connName, segPoints] of connectionSegmentPoints) {
      // Find the intersection of all segment's availableZ
      let commonZ: number[] | null = null
      for (const sp of segPoints) {
        const segment = this.dedupedSegmentMap.get(sp.segmentId)
        if (!segment) continue
        if (commonZ === null) {
          commonZ = [...segment.availableZ]
        } else {
          commonZ = commonZ.filter((z) => segment.availableZ.includes(z))
        }
      }

      if (commonZ && commonZ.length > 1) {
        mlcpConnections.push(connName)
        connectionAvailableZ.set(connName, commonZ)
      }
    }

    if (mlcpConnections.length === 0) return

    // Build a crossing graph between MLCP connections
    // Two connections cross if the line from their start to end points intersects
    const crossingPairs = new Set<string>()

    // Find the endpoint segment points for each MLCP connection
    const connectionEndpoints = new Map<
      string,
      { start: SegmentPoint; end: SegmentPoint }
    >()

    for (const connName of mlcpConnections) {
      const segPoints = connectionSegmentPoints.get(connName)!
      if (segPoints.length < 2) continue

      // Find the two points farthest apart (the endpoints)
      let maxDist = 0
      let startPoint = segPoints[0]
      let endPoint = segPoints[segPoints.length > 1 ? 1 : 0]

      for (let i = 0; i < segPoints.length; i++) {
        for (let j = i + 1; j < segPoints.length; j++) {
          const dist = distance(segPoints[i], segPoints[j])
          if (dist > maxDist) {
            maxDist = dist
            startPoint = segPoints[i]
            endPoint = segPoints[j]
          }
        }
      }

      connectionEndpoints.set(connName, { start: startPoint, end: endPoint })
    }

    // Check for crossings between all pairs of MLCP connections
    for (let i = 0; i < mlcpConnections.length; i++) {
      for (let j = i + 1; j < mlcpConnections.length; j++) {
        const conn1 = mlcpConnections[i]
        const conn2 = mlcpConnections[j]

        const ep1 = connectionEndpoints.get(conn1)
        const ep2 = connectionEndpoints.get(conn2)

        if (!ep1 || !ep2) continue

        // Check if the line segments from start to end cross
        if (doSegmentsIntersect(ep1.start, ep1.end, ep2.start, ep2.end)) {
          const key = conn1 < conn2 ? `${conn1}|${conn2}` : `${conn2}|${conn1}`
          crossingPairs.add(key)
        }
      }
    }

    // Graph coloring: assign layers to minimize crossings
    const connectionLayer = new Map<string, number>()

    // Simple greedy coloring
    for (const connName of mlcpConnections) {
      const availableZ = connectionAvailableZ.get(connName)!
      const usedLayers = new Set<number>()

      // Find layers used by crossing connections
      for (const pair of crossingPairs) {
        if (pair.includes(connName)) {
          const otherConn = pair.split("|").find((c) => c !== connName)
          if (otherConn && connectionLayer.has(otherConn)) {
            usedLayers.add(connectionLayer.get(otherConn)!)
          }
        }
      }

      // Pick the first available layer not used by crossing connections
      let selectedLayer = availableZ[0]
      for (const z of availableZ) {
        if (!usedLayers.has(z)) {
          selectedLayer = z
          break
        }
      }

      connectionLayer.set(connName, selectedLayer)
    }

    // Apply the layer assignments to all segment points
    for (const [connName, layer] of connectionLayer) {
      const segPoints = connectionSegmentPoints.get(connName)!
      for (const sp of segPoints) {
        // Verify this layer is available for the segment
        const segment = this.dedupedSegmentMap.get(sp.segmentId)
        if (segment && segment.availableZ.includes(layer)) {
          sp.z = layer
        }
      }
    }
  }

  computeInitialPfMap() {
    const pfMap = new Map<CapacityMeshNodeId, number>()

    for (const [nodeId, node] of this.nodeMap.entries()) {
      pfMap.set(nodeId, this.computeNodePf(node))
    }

    return pfMap
  }

  computeNodePf(node: CapacityMeshNode) {
    const {
      numSameLayerCrossings,
      numEntryExitLayerChanges,
      numTransitionCrossings,
    } = getIntraNodeCrossingsFromSegmentPoints(
      (this.nodeToSegmentPointMap.get(node.capacityMeshNodeId) ?? []).map(
        (segPointId) => this.segmentPointMap.get(segPointId)!,
      ),
    )

    const probabilityOfFailure = calculateNodeProbabilityOfFailure(
      node,
      numSameLayerCrossings,
      numEntryExitLayerChanges,
      numTransitionCrossings,
    )

    return probabilityOfFailure
  }

  _step() {
    if (this.iterations >= this.MAX_ITERATIONS - 1) {
      this.solved = true
      return
    }
    if (!this.activeSubSolver) {
      // Find the node with the highest probability of failure
      let highestPfNodeId = null
      let highestPf = 0
      for (const [nodeId, pf] of this.nodePfMap.entries()) {
        const pfReduced =
          pf *
          (1 -
            (this.attemptsToFixNode.get(nodeId) ?? 0) / this.MAX_NODE_ATTEMPTS)
        if (pfReduced > highestPf) {
          highestPf = pf
          highestPfNodeId = nodeId
        }
      }

      if (!highestPfNodeId || highestPf < this.ACCEPTABLE_PF) {
        this.solved = true
        return
      }

      this.attemptsToFixNode.set(
        highestPfNodeId,
        (this.attemptsToFixNode.get(highestPfNodeId) ?? 0) + 1,
      )
      this.activeSubSolver = new CachedUnravelSectionSolver({
        dedupedSegments: this.dedupedSegments,
        dedupedSegmentMap: this.dedupedSegmentMap,
        nodeMap: this.nodeMap,
        nodeIdToSegmentIds: this.nodeIdToSegmentIds,
        segmentIdToNodeIds: this.segmentIdToNodeIds,
        colorMap: this.colorMap,
        rootNodeId: highestPfNodeId,
        MUTABLE_HOPS: this.MUTABLE_HOPS,
        segmentPointMap: this.segmentPointMap,
        nodeToSegmentPointMap: this.nodeToSegmentPointMap,
        segmentToSegmentPointMap: this.segmentToSegmentPointMap,
        cacheProvider: this.cacheProvider,
      })
    }

    this.activeSubSolver.step()

    const { bestCandidate, originalCandidate, lastProcessedCandidate } =
      this.activeSubSolver

    // const shouldEarlyStop =
    //   this.activeSubSolver.iterationsSinceImprovement >
    //   this.MAX_ITERATIONS_WITHOUT_IMPROVEMENT

    // cn90994
    if (this.activeSubSolver.failed) {
      this.stats.failedOptimizations += 1
      this.activeSubSolver = null
      return
    }
    if (this.activeSubSolver.solved) {
      if (this.activeSubSolver.cacheHit) {
        this.stats.cacheHits += 1
      } else {
        this.stats.cacheMisses += 1
      }

      // Incorporate the changes from the active solver
      const foundBetterSolution =
        bestCandidate && bestCandidate.g < originalCandidate!.g

      if (foundBetterSolution) {
        this.stats.successfulOptimizations += 1
        // Modify the points using the pointModifications of the candidate
        for (const [
          segmentPointId,
          pointModification,
        ] of bestCandidate.pointModifications.entries()) {
          const segmentPoint = this.segmentPointMap.get(segmentPointId)!
          segmentPoint.x = pointModification.x ?? segmentPoint.x
          segmentPoint.y = pointModification.y ?? segmentPoint.y
          segmentPoint.z = pointModification.z ?? segmentPoint.z
        }

        // Update node failure probabilities
        for (const nodeId of this.activeSubSolver.unravelSection.allNodeIds) {
          this.nodePfMap.set(
            nodeId,
            this.computeNodePf(this.nodeMap.get(nodeId)!),
          )
        }
      } else {
        // did not find better solution
        this.stats.failedOptimizations += 1
      }

      this.activeSubSolver = null
    }
  }

  visualize(): GraphicsObject {
    if (this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }

    const graphics: GraphicsObject &
      Pick<Required<GraphicsObject>, "points" | "lines" | "rects" | "circles"> =
      {
        lines: [],
        points: [],
        rects: [],
        circles: [],
        coordinateSystem: "cartesian",
        title: "Unravel Multi Section Solver",
      }

    // Visualize nodes
    for (const [nodeId, node] of this.nodeMap.entries()) {
      const probabilityOfFailure = this.nodePfMap.get(nodeId) || 0
      // Color based on probability of failure - red for high, gradient to green for low
      const pf = Math.min(probabilityOfFailure, 1) // Cap at 1
      const red = Math.floor(255 * pf)
      const green = Math.floor(255 * (1 - pf))
      const color = `rgb(${red}, ${green}, 0)`

      if ((this.attemptsToFixNode.get(nodeId) ?? 0) === 0 && pf === 0) {
        continue
      }

      graphics.rects.push({
        center: node.center,
        label: [
          nodeId,
          `${node.width.toFixed(2)}x${node.height.toFixed(2)}`,
          `Pf: ${probabilityOfFailure.toFixed(3)}`,
        ].join("\n"),
        color,
        width: node.width / 8,
        height: node.height / 8,
      })
    }

    // Visualize segment points
    for (const segmentPoint of this.segmentPointMap.values()) {
      const segment = this.dedupedSegmentMap.get(segmentPoint.segmentId)
      graphics.points.push({
        x: segmentPoint.x,
        y: segmentPoint.y,
        label: [
          segmentPoint.segmentPointId,
          segmentPoint.segmentId,
          `z: ${segmentPoint.z}`,
          `segment.availableZ: ${segment?.availableZ.join(",")}`,
        ].join("\n"),
        color: this.colorMap[segmentPoint.connectionName] || "#000",
      })
    }

    // Connect segment points that belong to the same segment
    // Group points by segment ID
    const pointsBySegment = new Map<string, SegmentPoint[]>()
    for (const point of this.segmentPointMap.values()) {
      if (!pointsBySegment.has(point.segmentId)) {
        pointsBySegment.set(point.segmentId, [])
      }
      pointsBySegment.get(point.segmentId)!.push(point)
    }

    // Connect points in each segment
    for (const [segmentId, points] of pointsBySegment.entries()) {
      if (points.length < 2) continue

      // Sort points by some logical order (this approximates the correct ordering)
      const sortedPoints = [...points].sort((a, b) =>
        a.x !== b.x ? a.x - b.x : a.y - b.y,
      )

      // Connect adjacent points in the sorted order
      for (let i = 0; i < sortedPoints.length - 1; i++) {
        graphics.lines.push({
          points: [
            { x: sortedPoints[i].x, y: sortedPoints[i].y },
            { x: sortedPoints[i + 1].x, y: sortedPoints[i + 1].y },
          ],
          strokeColor: this.colorMap[segmentId] || "#000",
        })
      }
    }

    // Connect points with the same connection name that share a node
    const processedConnections = new Set<string>()
    const allPoints = Array.from(this.segmentPointMap.values())

    for (let i = 0; i < allPoints.length; i++) {
      const point1 = allPoints[i]
      for (let j = i + 1; j < allPoints.length; j++) {
        const point2 = allPoints[j]

        // Skip if they have different connection names or are in the same segment
        if (
          point1.connectionName !== point2.connectionName ||
          point1.segmentId === point2.segmentId
        ) {
          continue
        }

        // Check if they share a node
        const hasSharedNode = point1.capacityMeshNodeIds.some((nodeId) =>
          point2.capacityMeshNodeIds.includes(nodeId),
        )

        if (hasSharedNode) {
          const connectionKey = `${point1.segmentPointId}-${point2.segmentPointId}`
          if (processedConnections.has(connectionKey)) continue
          processedConnections.add(connectionKey)

          // Determine line style based on layer (z) values
          const sameLayer = point1.z === point2.z
          const layer = point1.z

          let strokeDash: string | undefined
          if (sameLayer) {
            strokeDash = layer === 0 ? undefined : "10 5" // Solid for layer 0, long dash for other layers
          } else {
            strokeDash = "3 3 10" // Mixed dash for transitions between layers
          }

          graphics.lines.push({
            points: [
              { x: point1.x, y: point1.y },
              { x: point2.x, y: point2.y },
            ],
            strokeDash,
            strokeColor: this.colorMap[point1.connectionName] || "#666",
          })
        }
      }
    }
    return graphics
  }

  getNodesWithPortPoints(): NodeWithPortPoints[] {
    if (!this.solved) {
      throw new Error(
        "CapacitySegmentToPointSolver not solved, can't give port points yet",
      )
    }
    const nodeWithPortPointsMap = new Map<string, NodeWithPortPoints>()
    for (const segment of this.dedupedSegments) {
      const segId = segment.nodePortSegmentId!
      for (const nodeId of this.segmentIdToNodeIds.get(segId)!) {
        const node = this.nodeMap.get(nodeId)!
        if (!nodeWithPortPointsMap.has(nodeId)) {
          nodeWithPortPointsMap.set(nodeId, {
            capacityMeshNodeId: nodeId,
            portPoints: [],
            center: node.center,
            width: node.width,
            height: node.height,
          })
        }
      }
    }

    for (const segmentPoint of this.segmentPointMap.values()) {
      for (const nodeId of segmentPoint.capacityMeshNodeIds) {
        const nodeWithPortPoints = nodeWithPortPointsMap.get(nodeId)
        if (nodeWithPortPoints) {
          nodeWithPortPoints.portPoints.push({
            x: segmentPoint.x,
            y: segmentPoint.y,
            z: segmentPoint.z,
            connectionName: segmentPoint.connectionName,
          })
        }
      }
    }

    return Array.from(nodeWithPortPointsMap.values())
  }
}
