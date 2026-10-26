import Flatbush from "flatbush"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNode } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { prepareTopologyMergingInput } from "./topology-merging-input"
import {
  createTopologyMergingOutputNodes,
  type TopologyMergingOutputProvenance,
  validateTopologyMergingOutput,
} from "./topology-merging-output"
import {
  compactTopologyMergingRegions,
  getCanonicalCoordinates,
  getHorizontalMergeBucketKey,
  getLayerTopologiesForCoveredNodes,
  restoreAuthoritativeTargetRegions,
} from "./topology-merging-regions"
import { TOPOLOGY_MERGING_EPSILON } from "./topology-merging-types"
import type {
  PreparedTopologyMergingNode,
  TopologyMergingRegion,
  TopologyMergingLayerTopology,
  TopologyMergingSolverParams,
} from "./topology-merging-types"

export type {
  TopologyMergingNodeGroup,
  TopologyMergingSolverParams,
} from "./topology-merging-types"

export class TopologyMergingSolver extends BaseSolver {
  private readonly preparedNodes: PreparedTopologyMergingNode[]
  private readonly nodeSpatialIndex: Flatbush | null
  private readonly preparedNodeBySourceKey: Map<
    string,
    PreparedTopologyMergingNode
  >
  private readonly outputProvenance: TopologyMergingOutputProvenance = {
    groupIndexesByNodeId: new Map<string, number[]>(),
    sourceKeysByNodeId: new Map<string, string[]>(),
  }
  private readonly xCoordinates: number[]
  private readonly atomicRegions: TopologyMergingRegion[] = []
  private outputNodes: CapacityMeshNode[] = []
  private logicalAtomicRegionCount = 0
  private previousSlabRegionsByKey = new Map<string, TopologyMergingRegion>()
  private currentXIndex = 0
  private previousSlabLayerTopologies = new Map<
    string,
    TopologyMergingLayerTopology[]
  >()

  constructor(public readonly inputProblem: TopologyMergingSolverParams) {
    super()
    this.MAX_ITERATIONS = 100_000

    const { preparedNodes, preparedNodeBySourceKey } =
      prepareTopologyMergingInput(inputProblem)
    this.preparedNodes = preparedNodes
    this.preparedNodeBySourceKey = preparedNodeBySourceKey
    this.nodeSpatialIndex = inputProblem.nodeGroups.length > 1
      ? new Flatbush(preparedNodes.length)
      : null
    if (this.nodeSpatialIndex) {
      for (const { bounds } of preparedNodes) {
        this.nodeSpatialIndex.add(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY)
      }
      this.nodeSpatialIndex.finish()
    }
    this.xCoordinates = getCanonicalCoordinates(
      this.preparedNodes.flatMap(({ bounds }) => [bounds.minX, bounds.maxX]),
    )
    this.stats = {
      inputNodeCount: this.preparedNodes.length,
      xSlabCount: Math.max(0, this.xCoordinates.length - 1),
      processedXSlabCount: 0,
      atomicRegionCount: 0,
      outputNodeCount: 0,
      layerTopologyComputations: 0,
      layerTopologyReuses: 0,
      peakLayerTopologyCacheEntries: 0,
    }
  }

  override getConstructorParams(): [TopologyMergingSolverParams] {
    return [this.inputProblem]
  }

  override _step(): void {
    if (this.inputProblem.nodeGroups.length === 1) {
      this.completePassthroughTopology()
      return
    }

    if (this.currentXIndex < this.xCoordinates.length - 1) {
      this.processCurrentXSlab()
      this.currentXIndex += 1
      this.stats.processedXSlabCount = this.currentXIndex
      this.stats.atomicRegionCount = this.logicalAtomicRegionCount
      return
    }

    const topologyRegions = restoreAuthoritativeTargetRegions({
      regions: this.atomicRegions,
      preparedNodeBySourceKey: this.preparedNodeBySourceKey,
    })
    const compactedRegions = compactTopologyMergingRegions(topologyRegions)
    this.outputNodes = createTopologyMergingOutputNodes({
      regions: compactedRegions,
      preparedNodeBySourceKey: this.preparedNodeBySourceKey,
      nodeGroups: this.inputProblem.nodeGroups,
      provenance: this.outputProvenance,
    })
    validateTopologyMergingOutput({
      nodes: this.outputNodes,
      preparedNodeBySourceKey: this.preparedNodeBySourceKey,
      provenance: this.outputProvenance,
    })
    this.stats.outputNodeCount = this.outputNodes.length
    this.stats.compactedRegionCount = compactedRegions.length
    // Completed output and visualization use outputNodes, not sweep work regions.
    // Keep work available on validation failures, and release it only on success.
    this.atomicRegions.length = 0
    this.previousSlabRegionsByKey.clear()
    this.previousSlabLayerTopologies.clear()
    this.solved = true
  }

  override getOutput(): CapacityMeshNode[] {
    if (!this.solved) {
      throw new Error(
        "TopologyMergingSolver: getOutput() called before the solver completed",
      )
    }

    return this.outputNodes
  }

  computeProgress(): number {
    const slabCount = Math.max(1, this.xCoordinates.length - 1)
    if (this.solved) return 1
    return Math.min(0.99, this.currentXIndex / slabCount)
  }

  override visualize(): GraphicsObject {
    const nodes = this.solved
      ? this.outputNodes
      : createTopologyMergingOutputNodes({
          regions: this.atomicRegions,
          preparedNodeBySourceKey: this.preparedNodeBySourceKey,
          nodeGroups: this.inputProblem.nodeGroups,
          provenance: this.outputProvenance,
          preserveSourceIds: false,
        })

    return {
      title: `Topology Merging: ${nodes.length} refined regions`,
      coordinateSystem: "cartesian",
      rects: nodes.map((node) => {
        const rect = createRectFromCapacityNode(node, {
          rectMargin: 0.01,
          zOffset: 0.02,
        })
        return {
          ...rect,
          label: `${node.capacityMeshNodeId}\navailableZ: ${node.availableZ.join(",")}\ncomponent: ${node._isComponentTopologyNode ? "yes" : "no"}`,
        }
      }),
      lines: [],
      points: [],
      circles: [],
      texts: [],
    }
  }

  private completePassthroughTopology(): void {
    const passthroughGroup = this.inputProblem.nodeGroups[0]!
    this.outputNodes = passthroughGroup.nodes
    for (const node of this.outputNodes) {
      this.outputProvenance.groupIndexesByNodeId.set(
        node.capacityMeshNodeId,
        [0],
      )
      this.outputProvenance.sourceKeysByNodeId.set(node.capacityMeshNodeId, [
        `${passthroughGroup.groupId}:${node.capacityMeshNodeId}`,
      ])
    }
    this.stats.processedXSlabCount = this.stats.xSlabCount
    this.stats.atomicRegionCount = 0
    this.stats.compactedRegionCount = 0
    this.stats.outputNodeCount = this.outputNodes.length
    this.stats.passthroughNodeCount = this.outputNodes.length
    this.solved = true
  }

  private processCurrentXSlab(): void {
    const minX = this.xCoordinates[this.currentXIndex]!
    const maxX = this.xCoordinates[this.currentXIndex + 1]!
    if (maxX - minX <= TOPOLOGY_MERGING_EPSILON) return

    const slabRegionsByKey = new Map<string, TopologyMergingRegion>()
    const x = (minX + maxX) / 2
    if (!this.nodeSpatialIndex) {
      throw new Error("TopologyMergingSolver: multi-group merge requires its node index")
    }
    const nodeIndexesInXSlab = this.nodeSpatialIndex
      .search(
        x - TOPOLOGY_MERGING_EPSILON,
        -Infinity,
        x + TOPOLOGY_MERGING_EPSILON,
        Infinity,
      )
      .sort((a, b) => a - b)
      .filter((index) => {
        const { bounds } = this.preparedNodes[index]!
        return x >= bounds.minX - TOPOLOGY_MERGING_EPSILON &&
          x <= bounds.maxX + TOPOLOGY_MERGING_EPSILON
      })
    const nodesInXSlab = nodeIndexesInXSlab.map(
      (index) => this.preparedNodes[index]!,
    )
    const nodesByMinimumY = nodesInXSlab
      .map((node, index) => ({ node, index }))
      .sort((a, b) => a.node.bounds.minY - b.node.bounds.minY)
    const nodesByMaximumY = [...nodesByMinimumY].sort(
      (a, b) => a.node.bounds.maxY - b.node.bounds.maxY,
    )
    const activeNodeIndexes = new Set<number>()
    const slabLayerTopologies = new Map<string, TopologyMergingLayerTopology[]>()
    let minimumYIndex = 0
    let maximumYIndex = 0
    const yCoordinates = getCanonicalCoordinates(
      nodesInXSlab.flatMap(({ bounds }) => [bounds.minY, bounds.maxY]),
    )

    for (let yIndex = 0; yIndex < yCoordinates.length - 1; yIndex++) {
      const minY = yCoordinates[yIndex]!
      const maxY = yCoordinates[yIndex + 1]!
      if (maxY - minY <= TOPOLOGY_MERGING_EPSILON) continue

      const point = { x, y: (minY + maxY) / 2 }
      // Board-world millimetres. Keep the same inclusive tolerance and source
      // order as the indexed point query, but sweep the already selected slab.
      while (
        minimumYIndex < nodesByMinimumY.length &&
        nodesByMinimumY[minimumYIndex]!.node.bounds.minY <=
          point.y + TOPOLOGY_MERGING_EPSILON
      ) {
        activeNodeIndexes.add(nodesByMinimumY[minimumYIndex]!.index)
        minimumYIndex += 1
      }
      while (
        maximumYIndex < nodesByMaximumY.length &&
        nodesByMaximumY[maximumYIndex]!.node.bounds.maxY <
          point.y - TOPOLOGY_MERGING_EPSILON
      ) {
        activeNodeIndexes.delete(nodesByMaximumY[maximumYIndex]!.index)
        maximumYIndex += 1
      }
      if (activeNodeIndexes.size === 0) continue
      const coveringIndexes = [...activeNodeIndexes].sort((a, b) => a - b)
      const coveringNodes = coveringIndexes.map((index) => nodesInXSlab[index]!)
      // Global numeric indexes are stable across slabs and unambiguous even
      // when source IDs contain delimiters. Retain only adjacent-slab results.
      const coverageKey = coveringIndexes
        .map((index) => nodeIndexesInXSlab[index]!)
        .join(",")
      let layerTopologies = slabLayerTopologies.get(coverageKey) ??
        this.previousSlabLayerTopologies.get(coverageKey)
      if (layerTopologies === undefined) {
        layerTopologies = getLayerTopologiesForCoveredNodes({
          coveringNodes,
          nodeGroups: this.inputProblem.nodeGroups,
          layerCount: this.inputProblem.layerCount,
        })
        this.stats.layerTopologyComputations += 1
      } else {
        this.stats.layerTopologyReuses += 1
      }
      slabLayerTopologies.set(coverageKey, layerTopologies)
      for (const layerTopology of layerTopologies) {
        const region: TopologyMergingRegion = {
          bounds: { minX, maxX, minY, maxY },
          availableZ: layerTopology.availableZ,
          sourceKeys: layerTopology.sourceKeys,
          topologyMode: layerTopology.topologyMode,
          topologySignature: layerTopology.topologySignature,
        }
        const key = getHorizontalMergeBucketKey(region)
        const previous = this.previousSlabRegionsByKey.get(key)
        this.logicalAtomicRegionCount += 1
        if (
          previous &&
          Math.abs(previous.bounds.maxX - minX) <= TOPOLOGY_MERGING_EPSILON
        ) {
          previous.bounds.maxX = maxX
          slabRegionsByKey.set(key, previous)
        } else {
          this.atomicRegions.push(region)
          slabRegionsByKey.set(key, region)
        }
      }
    }
    this.stats.peakLayerTopologyCacheEntries = Math.max(
      this.stats.peakLayerTopologyCacheEntries,
      this.previousSlabLayerTopologies.size + slabLayerTopologies.size,
    )
    this.previousSlabLayerTopologies = slabLayerTopologies
    this.previousSlabRegionsByKey = slabRegionsByKey
  }
}
