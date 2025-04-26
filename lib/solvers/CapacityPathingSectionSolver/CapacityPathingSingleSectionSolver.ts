import {
  CapacityMeshNode,
  CapacityMeshEdge,
  CapacityMeshNodeId,
} from "lib/types"
import { ConnectionPathWithNodes } from "../CapacityPathingSolver/CapacityPathingSolver"
import { GraphicsObject } from "graphics-debug"
import { getNodeEdgeMap } from "../CapacityMeshSolver/getNodeEdgeMap"
import { BaseSolver } from "../BaseSolver"
import { visualizeSection } from "./visualizeSection"
import { CpssPathingSolverHyperParameters } from "./CapacityPathingSingleSectionPathingSolver"
import { HyperCapacityPathingSingleSectionPathingSolver } from "./HyperCapacityPathingSingleSectionPathingSolver"

export interface CapacityPathingSingleSectionSolverInput {
  centerNodeId: CapacityMeshNodeId
  connectionsWithNodes: Array<ConnectionPathWithNodes>
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
  colorMap: Record<string, string>
  hyperParameters?: CpssPathingSolverHyperParameters
}

export class CapacityPathingSingleSectionSolver extends BaseSolver {
  centerNodeId: CapacityMeshNodeId
  connectionsWithNodes: Array<ConnectionPathWithNodes>
  nodes: CapacityMeshNode[]
  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  edges: CapacityMeshEdge[]
  nodeEdgeMap: Map<CapacityMeshNodeId, CapacityMeshEdge[]>
  expansionDegrees: number
  colorMap: Record<string, string>
  sectionNodes: CapacityMeshNode[]
  sectionEdges: CapacityMeshEdge[] // Added sectionEdges property
  sectionConnectionTerminals: Array<{
    connectionName: string
    startNodeId: CapacityMeshNodeId
    endNodeId: CapacityMeshNodeId
  }>
  activeSubSolver?: HyperCapacityPathingSingleSectionPathingSolver | null = null

  constructor(params: CapacityPathingSingleSectionSolverInput) {
    super()

    this.MAX_ITERATIONS = 100_000
    this.colorMap = params.colorMap
    this.centerNodeId = params.centerNodeId
    this.connectionsWithNodes = params.connectionsWithNodes
    this.nodes = params.nodes
    this.nodeMap = new Map(this.nodes.map((n) => [n.capacityMeshNodeId, n]))
    this.edges = params.edges
    this.nodeEdgeMap = getNodeEdgeMap(this.edges)
    this.expansionDegrees = params.hyperParameters?.EXPANSION_DEGREES ?? 3

    this.sectionNodes = []
    this.sectionEdges = [] // Initialize sectionEdges
    this.sectionConnectionTerminals = []

    this.computeSectionNodesTerminalsAndEdges()

    // Use the Hyper solver
    this.activeSubSolver = new HyperCapacityPathingSingleSectionPathingSolver({
      sectionConnectionTerminals: this.sectionConnectionTerminals,
      sectionNodes: this.sectionNodes,
      sectionEdges: this.sectionEdges, // Pass sectionEdges here
      colorMap: this.colorMap,
      hyperParameters: params.hyperParameters,
    })
  }

  private computeSectionNodesTerminalsAndEdges() {
    const sectionNodeIds = new Set<CapacityMeshNodeId>()
    const queue: Array<{ nodeId: CapacityMeshNodeId; depth: number }> = [
      { nodeId: this.centerNodeId, depth: 0 },
    ]
    sectionNodeIds.add(this.centerNodeId)

    let head = 0
    while (head < queue.length) {
      const { nodeId, depth } = queue[head++]

      if (depth >= this.expansionDegrees) continue

      const neighbors =
        this.nodeEdgeMap
          .get(nodeId)
          ?.flatMap((edge) => edge.nodeIds.filter((id) => id !== nodeId)) ?? []

      for (const neighborId of neighbors) {
        if (!sectionNodeIds.has(neighborId)) {
          sectionNodeIds.add(neighborId)
          queue.push({ nodeId: neighborId, depth: depth + 1 })
        }
      }
    }

    this.sectionNodes = Array.from(sectionNodeIds).map(
      (id) => this.nodeMap.get(id)!,
    )

    // Compute section edges (edges where both nodes are in the section)
    this.sectionEdges = this.edges.filter((edge) => {
      const [nodeIdA, nodeIdB] = edge.nodeIds
      return sectionNodeIds.has(nodeIdA) && sectionNodeIds.has(nodeIdB)
    })

    // Compute terminals
    this.sectionConnectionTerminals = []
    for (const conn of this.connectionsWithNodes) {
      if (!conn.path) continue

      let startNodeId: CapacityMeshNodeId | null = null
      let endNodeId: CapacityMeshNodeId | null = null

      // Find the first node in the path that is within the section
      for (const node of conn.path) {
        if (sectionNodeIds.has(node.capacityMeshNodeId)) {
          startNodeId = node.capacityMeshNodeId
          break
        }
      }

      // Find the last node in the path that is within the section
      for (let i = conn.path.length - 1; i >= 0; i--) {
        const node = conn.path[i]
        if (sectionNodeIds.has(node.capacityMeshNodeId)) {
          endNodeId = node.capacityMeshNodeId
          break
        }
      }

      if (startNodeId && endNodeId) {
        this.sectionConnectionTerminals.push({
          connectionName: conn.connection.name,
          startNodeId,
          endNodeId,
        })
      }
    }
  }

  _step() {
    this.activeSubSolver?.step()
    if (this.activeSubSolver?.solved) {
      this.solved = true
      return
    }
    if (this.activeSubSolver?.failed) {
      this.failed = true
      this.error = this.activeSubSolver.error
      return
    }
  }

  getConstructorParams() {
    return [
      {
        centerNodeId: this.centerNodeId,
        connectionsWithNodes: this.connectionsWithNodes,
        nodes: this.nodes,
        edges: this.edges,
        expansionDegrees: this.expansionDegrees,
      },
    ] as const
  }

  visualize(): GraphicsObject {
    return visualizeSection({
      sectionNodes: this.sectionNodes,
      sectionEdges: this.sectionEdges, // Use the computed class property
      sectionConnectionTerminals: this.sectionConnectionTerminals,
      nodeMap: this.nodeMap,
      colorMap: this.colorMap,
      centerNodeId: this.centerNodeId,
      nodeOpacity: 0.001,
      title: `Section Solver (Center: ${this.centerNodeId}, Hops: ${this.expansionDegrees})`,
    })
  }
}
