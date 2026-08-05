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
  doesBoundsContainPoint,
  getCanonicalCoordinates,
  getLayerTopologiesForCoveredNodes,
  isAlignedFreeRegion,
  joinAlignedFreeLayerTopologies,
  restoreAuthoritativeTargetRegions,
  restoreAlignedFreeLayerTopologies,
} from "./topology-merging-regions"
import { TOPOLOGY_MERGING_EPSILON } from "./topology-merging-types"
import type {
  PreparedTopologyMergingNode,
  TopologyMergingRegion,
  TopologyMergingSolverParams,
} from "./topology-merging-types"

export type {
  TopologyMergingNodeGroup,
  TopologyMergingSolverParams,
} from "./topology-merging-types"

export class TopologyMergingSolver extends BaseSolver {
  private readonly preparedNodes: PreparedTopologyMergingNode[]
  private readonly preparedNodeBySourceKey: Map<
    string,
    PreparedTopologyMergingNode
  >
  private readonly targetNodes: PreparedTopologyMergingNode[]
  private readonly outputProvenance: TopologyMergingOutputProvenance = {
    groupIndexesByNodeId: new Map<string, number[]>(),
    sourceKeysByNodeId: new Map<string, string[]>(),
  }
  private readonly xCoordinates: number[]
  private readonly atomicRegions: TopologyMergingRegion[] = []
  private outputNodes: CapacityMeshNode[] = []
  private currentXIndex = 0

  constructor(public readonly inputProblem: TopologyMergingSolverParams) {
    super()
    this.MAX_ITERATIONS = 100_000

    const { preparedNodes, preparedNodeBySourceKey } =
      prepareTopologyMergingInput(inputProblem)
    this.preparedNodes = preparedNodes
    this.preparedNodeBySourceKey = preparedNodeBySourceKey
    this.targetNodes = preparedNodes.filter(({ node }) => node._containsTarget)
    this.xCoordinates = getCanonicalCoordinates(
      this.preparedNodes.flatMap(({ bounds }) => [bounds.minX, bounds.maxX]),
    )
    this.stats = {
      inputNodeCount: this.preparedNodes.length,
      xSlabCount: Math.max(0, this.xCoordinates.length - 1),
      processedXSlabCount: 0,
      atomicRegionCount: 0,
      outputNodeCount: 0,
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
      this.stats.atomicRegionCount = this.atomicRegions.length
      return
    }

    const topologyRegions = restoreAuthoritativeTargetRegions({
      regions: this.atomicRegions,
      preparedNodeBySourceKey: this.preparedNodeBySourceKey,
    })
    const compactedAlignedRegions =
      compactTopologyMergingRegions(topologyRegions)
    const localLayerAccessRegions = compactedAlignedRegions.flatMap((region) =>
      this.isRegionLargeEnoughForVia(region)
        ? [region]
        : restoreAlignedFreeLayerTopologies({
            region,
            preparedNodeBySourceKey: this.preparedNodeBySourceKey,
          }),
    )
    const compactedRegions = compactTopologyMergingRegions(
      localLayerAccessRegions,
    )
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

    const x = (minX + maxX) / 2
    const nodesInXSlab = this.preparedNodes.filter(
      ({ bounds }) =>
        x >= bounds.minX - TOPOLOGY_MERGING_EPSILON &&
        x <= bounds.maxX + TOPOLOGY_MERGING_EPSILON,
    )
    const yCoordinates = getCanonicalCoordinates(
      nodesInXSlab.flatMap(({ bounds }) => [bounds.minY, bounds.maxY]),
    )

    for (let yIndex = 0; yIndex < yCoordinates.length - 1; yIndex++) {
      const minY = yCoordinates[yIndex]!
      const maxY = yCoordinates[yIndex + 1]!
      if (maxY - minY <= TOPOLOGY_MERGING_EPSILON) continue

      const point = { x, y: (minY + maxY) / 2 }
      const coveringNodes = nodesInXSlab.filter(({ bounds }) =>
        doesBoundsContainPoint(bounds, point),
      )
      if (coveringNodes.length === 0) continue

      const rawLayerTopologies = getLayerTopologiesForCoveredNodes({
        coveringNodes,
        nodeGroups: this.inputProblem.nodeGroups,
        layerCount: this.inputProblem.layerCount,
      })
      const layerTopologies = joinAlignedFreeLayerTopologies({
        layerTopologies: rawLayerTopologies,
        canUseSourceAsFreeSpace: (sourceKey) => {
          const node = this.preparedNodeBySourceKey.get(sourceKey)?.node
          return Boolean(
            node && !node._containsObstacle && !node._isVirtualOffboard,
          )
        },
      })
      for (const layerTopology of layerTopologies) {
        const region: TopologyMergingRegion = {
          bounds: { minX, maxX, minY, maxY },
          availableZ: layerTopology.availableZ,
          sourceKeys: layerTopology.sourceKeys,
          topologyMode: layerTopology.topologyMode,
          topologySignature: layerTopology.topologySignature,
        }
        if (
          !isAlignedFreeRegion(region) ||
          this.targetNodes.some((target) =>
            this.doesRegionConnectAroundTarget(region, target),
          )
        ) {
          this.atomicRegions.push(region)
          continue
        }
        this.atomicRegions.push(
          ...restoreAlignedFreeLayerTopologies({
            region,
            preparedNodeBySourceKey: this.preparedNodeBySourceKey,
          }),
        )
      }
    }
  }

  private isRegionLargeEnoughForVia(region: TopologyMergingRegion): boolean {
    if (!isAlignedFreeRegion(region)) return true
    const width = region.bounds.maxX - region.bounds.minX
    const height = region.bounds.maxY - region.bounds.minY
    return Math.min(width, height) >= this.inputProblem.viaDiameter
  }

  private doesRegionConnectAroundTarget(
    region: TopologyMergingRegion,
    target: PreparedTopologyMergingNode,
  ): boolean {
    if (!target.node._containsTarget) return false
    if (!this.doBoundsShareSide(region.bounds, target.bounds)) return false

    const targetLayers = new Set(target.node.availableZ)
    const containsTargetLayer = region.availableZ.some((z) =>
      targetLayers.has(z),
    )
    const containsOtherLayer = region.availableZ.some(
      (z) => !targetLayers.has(z),
    )
    if (!containsTargetLayer || !containsOtherLayer) return false

    const continuesTargetTopology = region.sourceKeys.some((sourceKey) => {
      const source = this.preparedNodeBySourceKey.get(sourceKey)
      return (
        source?.groupIndex === target.groupIndex &&
        source.node.availableZ.some(
          (z) => region.availableZ.includes(z) && targetLayers.has(z),
        )
      )
    })
    if (!continuesTargetTopology) return false

    return region.sourceKeys.some((sourceKey) => {
      const source = this.preparedNodeBySourceKey.get(sourceKey)
      if (!source || source.groupIndex === target.groupIndex) return false

      const providesOtherLayer = source.node.availableZ.some(
        (z) => region.availableZ.includes(z) && !targetLayers.has(z),
      )
      if (!providesOtherLayer) return false

      // The other-layer free node must continue underneath this target.
      const overlapWidth =
        Math.min(source.bounds.maxX, target.bounds.maxX) -
        Math.max(source.bounds.minX, target.bounds.minX)
      const overlapHeight =
        Math.min(source.bounds.maxY, target.bounds.maxY) -
        Math.max(source.bounds.minY, target.bounds.minY)
      return (
        overlapWidth > TOPOLOGY_MERGING_EPSILON &&
        overlapHeight > TOPOLOGY_MERGING_EPSILON
      )
    })
  }

  private doBoundsShareSide(
    first: TopologyMergingRegion["bounds"],
    second: TopologyMergingRegion["bounds"],
  ): boolean {
    const overlapsVertically =
      Math.min(first.maxY, second.maxY) -
        Math.max(first.minY, second.minY) >
      TOPOLOGY_MERGING_EPSILON
    const touchesSide =
      Math.abs(first.minX - second.maxX) <= TOPOLOGY_MERGING_EPSILON ||
      Math.abs(first.maxX - second.minX) <= TOPOLOGY_MERGING_EPSILON
    if (overlapsVertically && touchesSide) return true

    const overlapsHorizontally =
      Math.min(first.maxX, second.maxX) -
        Math.max(first.minX, second.minX) >
      TOPOLOGY_MERGING_EPSILON
    const touchesTopOrBottom =
      Math.abs(first.minY - second.maxY) <= TOPOLOGY_MERGING_EPSILON ||
      Math.abs(first.maxY - second.minY) <= TOPOLOGY_MERGING_EPSILON
    return overlapsHorizontally && touchesTopOrBottom
  }
}
