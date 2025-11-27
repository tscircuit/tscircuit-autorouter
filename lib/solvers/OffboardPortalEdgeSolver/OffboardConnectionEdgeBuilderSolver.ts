import type { GraphicsObject } from "graphics-debug"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  GroupId,
  LayerName,
  Obstacle,
  ObstacleId,
} from "lib/types"
import { BaseSolver } from "../BaseSolver"
import { doRectsOverlap } from "lib/utils/doRectsOverlap"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type OffboardConnectionEdgeBuilderOpts = {
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
  obstacles: Obstacle[]
  layerCount: number
}

const MAX_NEIGHBOR_CONNECTIONS = 8

type LayerEntry = {
  layerName: LayerName
  z: number
}

type ObstacleLayerEntry = {
  obstacle: Obstacle
  layer: LayerEntry
}

type PortalGroupEntry = {
  anchor: CapacityMeshNodeId
  members: CapacityMeshNodeId[]
  nextIndex: number
}

/**
 * This solver identifies "assignable" obstacles that act as off-board connection
 * points. It creates synthetic nodes within these obstacles to serve as anchors
 * for routing. It then builds two types of edges:
 * 1.  "Bridge" edges to connect these synthetic nodes to the main routing grid.
 * 2.  "Portal" edges to create a fully connected graph between all synthetic
 *     nodes that share the same `offBoardConnectsTo` group ID.
 */
export class OffboardConnectionEdgeBuilderSolver extends BaseSolver {
  private readonly originalNodes: CapacityMeshNode[]
  private readonly originalEdges: CapacityMeshEdge[]
  private readonly obstacles: Obstacle[]
  private readonly layerCount: number

  private nodes: CapacityMeshNode[]
  private edges: CapacityMeshEdge[]
  private nodeMap: Map<string, CapacityMeshNode>
  private edgeKeySet: Set<string>
  private nextNodeId = 0
  private nextEdgeId = 0
  private portalEdgeCounter = 0
  private groupMembers: Map<GroupId, Set<CapacityMeshNodeId>> = new Map()
  private entryQueue: ObstacleLayerEntry[]
  private entryIndex = 0
  private portalQueue: PortalGroupEntry[] | null = null
  private portalQueueIndex = 0
  private phase: "entries" | "portal" | "done" = "entries"
  private syntheticNodeIds: Set<string> = new Set()
  private createdEdgeTypes: Map<string, "bridge" | "portal"> = new Map()

  /**
   * Initializes the solver with the current layout of nodes, edges, and obstacles.
   */
  constructor({
    nodes,
    edges,
    obstacles,
    layerCount,
  }: OffboardConnectionEdgeBuilderOpts) {
    super()
    this.originalNodes = nodes
    this.originalEdges = edges
    this.obstacles = obstacles
    this.layerCount = layerCount
    this.nodes = [...nodes]
    this.edges = [...edges]
    this.nodeMap = new Map(nodes.map((node) => [node.capacityMeshNodeId, node]))
    this.edgeKeySet = new Set(
      edges.map((edge) => this.getEdgeKey(edge.nodeIds[0], edge.nodeIds[1])),
    )
    this.entryQueue = this.buildEntryQueue()
  }

  /**
   * Executes the solver's state machine, processing obstacle entries and then
   * building portal edges.
   */
  _step(): void {
    if (this.phase === "done") {
      this.solved = true
      return
    }

    if (this.phase === "entries") {
      if (this.entryIndex >= this.entryQueue.length) {
        this.phase = "portal"
        return
      }
      const obstacleLayerToProcess = this.entryQueue[this.entryIndex++]!
      this.processObstacleLayerEntry(obstacleLayerToProcess)
      return
    }

    if (this.phase === "portal") {
      if (!this.portalQueue) this.portalQueue = this.buildPortalQueue()
      if (this.portalQueue.length === 0) {
        this.phase = "done"
        this.solved = true
        return
      }
      if (this.portalQueueIndex >= this.portalQueue.length) {
        this.phase = "done"
        this.solved = true
        return
      }
      const portalGroupToProcess = this.portalQueue[this.portalQueueIndex]!
      if (
        portalGroupToProcess.nextIndex >= portalGroupToProcess.members.length
      ) {
        this.portalQueueIndex++
        return
      }
      const portalMemberNodeId =
        portalGroupToProcess.members[portalGroupToProcess.nextIndex++]!
      this.addEdge(portalGroupToProcess.anchor, portalMemberNodeId, true)
      return
    }
  }

  /**
   * Scans obstacles and creates a queue of entries to be processed for each
   * layer an assignable obstacle exists on.
   */
  private buildEntryQueue(): ObstacleLayerEntry[] {
    const obstacleLayerEntriesToProcess: ObstacleLayerEntry[] = []
    for (const obstacle of this.obstacles) {
      if (!obstacle.netIsAssignable) continue
      if (!obstacle.offBoardConnectsTo?.length) continue
      const obstacleLayerDefinitions = this.getLayerEntries(obstacle)
      for (const layerDefinition of obstacleLayerDefinitions) {
        obstacleLayerEntriesToProcess.push({
          obstacle,
          layer: layerDefinition,
        })
      }
    }
    return obstacleLayerEntriesToProcess
  }

  /**
   * Processes a single obstacle-layer entry, creating or finding a corresponding
   * node and attaching it to its off-board groups.
   */
  private processObstacleLayerEntry(
    obstacleLayerToProcess: ObstacleLayerEntry,
  ) {
    const { obstacle, layer } = obstacleLayerToProcess
    const nodeForObstacleLayer = this.createSyntheticNodeForObstacleLayer(
      obstacle,
      layer,
    )
    if (!nodeForObstacleLayer) return
    this.attachGroups(nodeForObstacleLayer, obstacle.offBoardConnectsTo ?? [])
  }

  /**
   * Gets all layer entries (name and z-index) for a given obstacle.
   */
  private getLayerEntries(obstacle: Obstacle): LayerEntry[] {
    const layerDefinitions: LayerEntry[] = []
    if (obstacle.layers?.length) {
      for (const layerName of obstacle.layers) {
        layerDefinitions.push({
          layerName,
          z: mapLayerNameToZ(layerName, this.layerCount),
        })
      }
    } else if (obstacle.zLayers?.length) {
      for (const z of obstacle.zLayers) {
        layerDefinitions.push({ layerName: this.getLayerNameFromZ(z), z })
      }
    } else {
      layerDefinitions.push({ layerName: this.getLayerNameFromZ(0), z: 0 })
    }
    return layerDefinitions
  }

  /**
   * Converts a numeric z-index to its corresponding layer name.
   */
  private getLayerNameFromZ(z: number): LayerName {
    if (z === 0) return "top"
    if (z === this.layerCount - 1) return "bottom"
    return `inner${z}`
  }

  /**
   * Creates a new synthetic node at the center of an obstacle on a specific
   * layer to act as a connection point.
   */
  private createSyntheticNodeForObstacleLayer(
    obstacle: Obstacle,
    entry: LayerEntry,
  ): CapacityMeshNode | null {
    const isOverlappingExistingNodes = this.nodes.some(
      (node) =>
        node.availableZ.includes(entry.z) &&
        doRectsOverlap(
          { center: node.center, width: node.width, height: node.height },
          {
            center: obstacle.center,
            width: obstacle.width,
            height: obstacle.height,
          },
        ),
    )
    const syntheticNodePadSize = Math.max(
      0.2,
      Math.min(
        obstacle.width,
        obstacle.height,
        isOverlappingExistingNodes ? 0.8 : 2,
      ),
    )

    const newSyntheticNode: CapacityMeshNode = {
      capacityMeshNodeId: `offboard-port-${this.nextNodeId++}`,
      center: { x: obstacle.center.x, y: obstacle.center.y },
      width: syntheticNodePadSize,
      height: syntheticNodePadSize,
      layer: entry.layerName,
      availableZ: [entry.z],
      _containsObstacle: true,
      _completelyInsideObstacle: true,
    }

    this.nodes.push(newSyntheticNode)
    this.nodeMap.set(newSyntheticNode.capacityMeshNodeId, newSyntheticNode)
    this.syntheticNodeIds.add(newSyntheticNode.capacityMeshNodeId)
    this.connectSyntheticNodeToNeighbors(newSyntheticNode, entry.z)
    return newSyntheticNode
  }

  /**
   * Connects a newly created synthetic node to its nearest neighbors on the
   * same layer.
   */
  private connectSyntheticNodeToNeighbors(node: CapacityMeshNode, z: number) {
    const neighboringNodeCandidates = this.nodes
      .filter(
        (candidate) =>
          candidate.capacityMeshNodeId !== node.capacityMeshNodeId &&
          candidate.availableZ.includes(z),
      )
      .map((candidate) => ({
        node: candidate,
        distSq:
          (candidate.center.x - node.center.x) ** 2 +
          (candidate.center.y - node.center.y) ** 2,
      }))
      .sort((a, b) => a.distSq - b.distSq)
      .slice(0, MAX_NEIGHBOR_CONNECTIONS)

    for (const { node: neighborCandidate } of neighboringNodeCandidates) {
      this.addEdge(
        node.capacityMeshNodeId,
        neighborCandidate.capacityMeshNodeId,
        false,
      )
    }
  }

  /**
   * Associates a node with one or more off-board group IDs and adds it to the
   * internal tracking map for portal edge creation.
   */
  private attachGroups(node: CapacityMeshNode, groupIds: GroupId[]) {
    if (!groupIds.length) return
    for (const offBoardGroupId of groupIds) {
      if (!this.groupMembers.has(offBoardGroupId)) {
        this.groupMembers.set(offBoardGroupId, new Set())
      }
      this.groupMembers.get(offBoardGroupId)!.add(node.capacityMeshNodeId)
    }
  }

  /**
   * Creates a queue of portal groups to be processed for edge creation. Each
   * group consists of all nodes associated with the same off-board group ID.
   */
  private buildPortalQueue(): PortalGroupEntry[] {
    const portalGroupsToProcess: PortalGroupEntry[] = []
    for (const [, members] of this.groupMembers.entries()) {
      const nodeIdsInGroup = Array.from(members)
      if (nodeIdsInGroup.length < 2) continue
      const [portalAnchorNodeId, ...otherPortalNodeIds] = nodeIdsInGroup
      portalGroupsToProcess.push({
        anchor: portalAnchorNodeId,
        members: otherPortalNodeIds,
        nextIndex: 0,
      })
    }
    return portalGroupsToProcess
  }

  /**
   * Adds a new edge between two nodes, avoiding duplicates. Marks the edge as
   * a portal or a bridge.
   */
  private addEdge(
    nodeA: CapacityMeshNodeId,
    nodeB: CapacityMeshNodeId,
    isPortal: boolean,
  ) {
    const edgeUniquenessKey = this.getEdgeKey(nodeA, nodeB)
    if (this.edgeKeySet.has(edgeUniquenessKey)) return
    this.edgeKeySet.add(edgeUniquenessKey)
    const edge: CapacityMeshEdge = {
      capacityMeshEdgeId: isPortal
        ? `offboard-portal-${this.portalEdgeCounter++}`
        : `offboard-bridge-${this.nextEdgeId++}`,
      nodeIds: [nodeA, nodeB],
      isVirtualPortal: isPortal || undefined,
    }
    this.edges.push(edge)
    this.createdEdgeTypes.set(
      edge.capacityMeshEdgeId,
      isPortal ? "portal" : "bridge",
    )
  }

  /**
   * Creates a consistent, order-independent key for an edge based on the IDs
   * of the two nodes it connects.
   */
  private getEdgeKey(
    nodeA: CapacityMeshNodeId,
    nodeB: CapacityMeshNodeId,
  ): string {
    return nodeA < nodeB ? `${nodeA}:${nodeB}` : `${nodeB}:${nodeA}`
  }

  /**
   * Returns the final list of nodes, including any synthetic nodes created by
   * the solver.
   */
  getNodes(): CapacityMeshNode[] {
    return this.nodes
  }

  /**
   * Returns the final list of edges, including any bridge or portal edges
   * created by the solver.
   */
  getEdges(): CapacityMeshEdge[] {
    return this.edges
  }

  /**
   * Generates a visual representation of the solver's state for debugging.
   */
  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      rects: [],
      points: [],
      circles: [],
    }

    for (const node of this.nodes) {
      const isSyntheticNode = this.syntheticNodeIds.has(node.capacityMeshNodeId)
      graphics.rects!.push({
        center: node.center,
        width: node.width,
        height: node.height,
        stroke: isSyntheticNode ? "rgba(255,165,0,0.9)" : "rgba(0,0,0,0.2)",
        fill: isSyntheticNode ? "rgba(255,165,0,0.3)" : undefined,
        label: [node.capacityMeshNodeId].join("\n"),
      })
    }

    for (const edge of this.edges) {
      const createdEdgeType = this.createdEdgeTypes.get(edge.capacityMeshEdgeId)
      if (!createdEdgeType) continue
      const [fromNodeId, toNodeId] = edge.nodeIds
      const fromNode = this.nodeMap.get(fromNodeId)
      const toNode = this.nodeMap.get(toNodeId)
      if (!fromNode || !toNode) continue
      const isPortalEdge = createdEdgeType === "portal"
      graphics.lines!.push({
        points: [
          { x: fromNode.center.x, y: fromNode.center.y },
          { x: toNode.center.x, y: toNode.center.y },
        ],
        strokeColor: isPortalEdge
          ? "rgba(255,0,200,0.7)"
          : "rgba(255,165,0,0.7)",
        strokeDash: isPortalEdge ? "6 3" : undefined,
        strokeWidth: isPortalEdge ? 0.2 : 0.15,
      })
      graphics.points!.push(
        {
          x: fromNode.center.x,
          y: fromNode.center.y,
          color: isPortalEdge ? "rgba(255,0,200,0.9)" : "rgba(255,165,0,0.9)",
        },
        {
          x: toNode.center.x,
          y: toNode.center.y,
          color: isPortalEdge ? "rgba(255,0,200,0.9)" : "rgba(255,165,0,0.9)",
        },
      )
    }

    return graphics
  }
}
