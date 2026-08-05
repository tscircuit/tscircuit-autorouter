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
  finalizeAlignedViaRegions,
  getCanonicalCoordinates,
  getCrossLayerTargetAccessLayers,
  getLayerTopologiesForCoveredNodes,
  mergeViaCompatibleLayerTopologies,
  restoreAuthoritativeTargetRegions,
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
  private readonly outputProvenance: TopologyMergingOutputProvenance = {
    groupIndexesByNodeId: new Map<string, number[]>(),
    sourceKeysByNodeId: new Map<string, string[]>(),
  }
  private readonly xCoordinates: number[]
  private readonly targetAccessLayersBySourceKey: Map<string, number[]>
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
    this.targetAccessLayersBySourceKey =
      getCrossLayerTargetAccessLayers(preparedNodes)
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
    const viaSizedRegions =
      this.inputProblem.viaDiameter === undefined
        ? compactedAlignedRegions
        : finalizeAlignedViaRegions({
            regions: compactedAlignedRegions,
            minimumViaFootprint: this.inputProblem.viaDiameter,
            preparedNodeBySourceKey: this.preparedNodeBySourceKey,
          })
    const compactedRegions = compactTopologyMergingRegions(viaSizedRegions)
    this.outputNodes = createTopologyMergingOutputNodes({
      regions: compactedRegions,
      preparedNodeBySourceKey: this.preparedNodeBySourceKey,
      nodeGroups: this.inputProblem.nodeGroups,
      provenance: this.outputProvenance,
    })
    const diagnosticSource = this.preparedNodes.find(
      ({ node }) => node.capacityMeshNodeId === "cmn_1819",
    )
    if (diagnosticSource) {
      const point = { x: -23.755, y: -6.66 }
      const describeRegions = (regions: TopologyMergingRegion[]) =>
        regions.filter((region) => doesBoundsContainPoint(region.bounds, point))
      const diagnosticAtomicRegions = describeRegions(this.atomicRegions)
      const relatedSources = [
        ...new Set(
          diagnosticAtomicRegions.flatMap((region) => region.sourceKeys),
        ),
      ].map((sourceKey) => this.preparedNodeBySourceKey.get(sourceKey))
      throw new Error(
        `Topology target/free diagnostic: ${JSON.stringify({
          source: diagnosticSource,
          relatedSources,
          targetAccessLayers: this.targetAccessLayersBySourceKey.get(
            diagnosticSource.sourceKey,
          ),
          atomicRegions: diagnosticAtomicRegions,
          restoredRegions: describeRegions(topologyRegions),
          compactedAlignedRegions: describeRegions(compactedAlignedRegions),
          viaSizedRegions: describeRegions(viaSizedRegions),
          compactedRegions: describeRegions(compactedRegions),
          outputNodes: this.outputNodes.filter((node) =>
            doesBoundsContainPoint(
              {
                minX: node.center.x - node.width / 2,
                maxX: node.center.x + node.width / 2,
                minY: node.center.y - node.height / 2,
                maxY: node.center.y + node.height / 2,
              },
              point,
            ),
          ),
        })}`,
      )
    }
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
      const layerTopologies =
        this.inputProblem.viaDiameter !== undefined
          ? mergeViaCompatibleLayerTopologies({
              layerTopologies: rawLayerTopologies,
              canUseSourceAsFreeSpace: (sourceKey) => {
                const node = this.preparedNodeBySourceKey.get(sourceKey)?.node
                return Boolean(
                  node &&
                    !node._containsObstacle &&
                    !node._isVirtualOffboard,
                )
              },
              getTargetAccessLayers: (sourceKey) => {
                const node = this.preparedNodeBySourceKey.get(sourceKey)?.node
                return node?._containsObstacle && node._containsTarget
                  ? Array.from(
                      { length: this.inputProblem.layerCount },
                      (_, z) => z,
                    )
                  : undefined
              },
            })
          : rawLayerTopologies
      for (const layerTopology of layerTopologies) {
        this.atomicRegions.push({
          bounds: { minX, maxX, minY, maxY },
          availableZ: layerTopology.availableZ,
          sourceKeys: layerTopology.sourceKeys,
          topologyMode: layerTopology.topologyMode,
          topologySignature: layerTopology.topologySignature,
        })
      }
    }
  }
}
