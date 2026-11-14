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
  compactClosedAtomicRegions,
  compactTopologyMergingRegions,
  getCanonicalCoordinates,
  getLayerTopologiesForCoveredNodes,
  restoreAuthoritativeTargetRegions,
} from "./topology-merging-regions"
import { TOPOLOGY_MERGING_EPSILON } from "./topology-merging-types"
import type {
  HorizontalTopologyMergingBucketKey,
  PreparedTopologyMergingNode,
  TopologyMergingRegion,
  TopologyMergingSolverParams,
} from "./topology-merging-types"

export type {
  TopologyMergingNodeGroup,
  TopologyMergingSolverParams,
} from "./topology-merging-types"

const WORKING_NODE_RELEASE_THRESHOLD = 50_000
const RETAINED_ATOMIC_REGION_COMPACTION_THRESHOLD = 205_000
const RETAINED_ATOMIC_REGION_COMPACTION_STEP = 12_000

type TopologyMergingSourceSetKey = string
type LayerTopologySelection = ReturnType<
  typeof getLayerTopologiesForCoveredNodes
>

export class TopologyMergingSolver extends BaseSolver {
  private readonly preparedNodes: PreparedTopologyMergingNode[]
  private readonly nodesByMinX: PreparedTopologyMergingNode[]
  private readonly activeNodesInX: PreparedTopologyMergingNode[] = []
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
  private horizontalRegionByBucket = new Map<
    HorizontalTopologyMergingBucketKey,
    TopologyMergingRegion
  >()
  private layerTopologiesBySources = new Map<
    TopologyMergingSourceSetKey,
    LayerTopologySelection
  >()
  private readonly overruledTargetSourceKeys = new Set<string>()
  private readonly yPrecisionKeyByCoordinate = new Map<number, string>()
  private outputNodes: CapacityMeshNode[] = []
  private currentXIndex = 0
  private nextNodeByMinXIndex = 0
  private totalCreatedAtomicRegionCount = 0
  private nextCompactionThreshold = RETAINED_ATOMIC_REGION_COMPACTION_THRESHOLD

  constructor(public readonly inputProblem: TopologyMergingSolverParams) {
    super()

    const { preparedNodes, preparedNodeBySourceKey } =
      prepareTopologyMergingInput(inputProblem)
    this.preparedNodes = preparedNodes
    this.nodesByMinX = [...this.preparedNodes].sort(
      (a, b) => a.bounds.minX - b.bounds.minX,
    )
    this.preparedNodeBySourceKey = preparedNodeBySourceKey
    const xBoundaryValues = new Array<number>(this.preparedNodes.length * 2)
    for (let index = 0; index < this.preparedNodes.length; index++) {
      const { bounds } = this.preparedNodes[index]!
      xBoundaryValues[index * 2] = bounds.minX
      xBoundaryValues[index * 2 + 1] = bounds.maxX
    }
    this.xCoordinates = getCanonicalCoordinates(xBoundaryValues)
    this.MAX_ITERATIONS = Math.max(100_000, this.xCoordinates.length + 10)
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
      overruledTargetSourceKeys: this.overruledTargetSourceKeys,
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
    this.releaseTopologyScratch()
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
    this.releaseTopologyScratch()
    this.solved = true
  }

  private releaseTopologyScratch(): void {
    this.layerTopologiesBySources.clear()
    // Keep small meshes on their existing garbage-collection schedule.
    const workingNodeCount =
      this.preparedNodes.length +
      Math.max(this.atomicRegions.length, this.totalCreatedAtomicRegionCount)
    if (workingNodeCount < WORKING_NODE_RELEASE_THRESHOLD) return

    // Completed solvers stay attached to the pipeline. Keep the validated
    // output, original constructor input and stats; release temporary indexes.
    this.preparedNodes.length = 0
    this.nodesByMinX.length = 0
    this.activeNodesInX.length = 0
    this.preparedNodeBySourceKey.clear()
    this.xCoordinates.length = 0
    this.atomicRegions.length = 0
    this.horizontalRegionByBucket.clear()
    this.overruledTargetSourceKeys.clear()
    this.yPrecisionKeyByCoordinate.clear()
    this.outputProvenance.groupIndexesByNodeId.clear()
    this.outputProvenance.sourceKeysByNodeId.clear()
  }

  private processCurrentXSlab(): void {
    const minX = this.xCoordinates[this.currentXIndex]!
    const maxX = this.xCoordinates[this.currentXIndex + 1]!
    if (maxX - minX <= TOPOLOGY_MERGING_EPSILON) return

    const x = (minX + maxX) / 2
    while (
      this.nextNodeByMinXIndex < this.nodesByMinX.length &&
      this.nodesByMinX[this.nextNodeByMinXIndex]!.bounds.minX -
        TOPOLOGY_MERGING_EPSILON <=
        x
    ) {
      this.activeNodesInX.push(this.nodesByMinX[this.nextNodeByMinXIndex]!)
      this.nextNodeByMinXIndex += 1
    }
    let activeWriteIndex = 0
    for (
      let activeIndex = 0;
      activeIndex < this.activeNodesInX.length;
      activeIndex++
    ) {
      const candidateNode = this.activeNodesInX[activeIndex]!
      if (x <= candidateNode.bounds.maxX + TOPOLOGY_MERGING_EPSILON) {
        this.activeNodesInX[activeWriteIndex] = candidateNode
        activeWriteIndex += 1
      }
    }
    this.activeNodesInX.length = activeWriteIndex

    const nextHorizontalRegionByBucket = new Map<
      HorizontalTopologyMergingBucketKey,
      TopologyMergingRegion
    >()
    const nextLayerTopologiesBySources = new Map<
      TopologyMergingSourceSetKey,
      LayerTopologySelection
    >()
    if (this.activeNodesInX.length === 0) {
      this.horizontalRegionByBucket = nextHorizontalRegionByBucket
      this.layerTopologiesBySources = nextLayerTopologiesBySources
      return
    }

    const yBoundaryValues = new Array<number>(this.activeNodesInX.length * 2)
    for (let index = 0; index < this.activeNodesInX.length; index++) {
      const { bounds } = this.activeNodesInX[index]!
      yBoundaryValues[index * 2] = bounds.minY
      yBoundaryValues[index * 2 + 1] = bounds.maxY
    }
    const yCoordinates = getCanonicalCoordinates(yBoundaryValues)
    const slabNodesByMinY = [...this.activeNodesInX].sort(
      (a, b) => a.bounds.minY - b.bounds.minY,
    )
    const coveringNodes: PreparedTopologyMergingNode[] = []
    let nextNodeByMinYIndex = 0

    for (let yIndex = 0; yIndex < yCoordinates.length - 1; yIndex++) {
      const minY = yCoordinates[yIndex]!
      const maxY = yCoordinates[yIndex + 1]!
      if (maxY - minY <= TOPOLOGY_MERGING_EPSILON) continue

      const y = (minY + maxY) / 2
      let coveringWriteIndex = 0
      for (
        let coveringIndex = 0;
        coveringIndex < coveringNodes.length;
        coveringIndex++
      ) {
        const activeNode = coveringNodes[coveringIndex]!
        if (y <= activeNode.bounds.maxY + TOPOLOGY_MERGING_EPSILON) {
          coveringNodes[coveringWriteIndex] = activeNode
          coveringWriteIndex += 1
        }
      }
      coveringNodes.length = coveringWriteIndex

      while (
        nextNodeByMinYIndex < slabNodesByMinY.length &&
        slabNodesByMinY[nextNodeByMinYIndex]!.bounds.minY -
          TOPOLOGY_MERGING_EPSILON <=
          y
      ) {
        const incomingNode = slabNodesByMinY[nextNodeByMinYIndex]!
        nextNodeByMinYIndex += 1
        if (y > incomingNode.bounds.maxY + TOPOLOGY_MERGING_EPSILON) continue

        const incomingRank = incomingNode.localeRank ?? 0
        let low = 0
        let high = coveringNodes.length
        while (low < high) {
          const mid = (low + high) >>> 1
          if ((coveringNodes[mid]!.localeRank ?? 0) < incomingRank) {
            low = mid + 1
          } else {
            high = mid
          }
        }
        coveringNodes.splice(low, 0, incomingNode)
      }
      if (coveringNodes.length === 0) continue

      const sourceSetKey: TopologyMergingSourceSetKey = JSON.stringify(
        coveringNodes.map(({ groupIndex, sourceKey }): [number, string] => [
          groupIndex,
          sourceKey,
        ]),
      )
      // Neighboring X slabs often cover the same source nodes. Keep only
      // the current and previous slab's pure layer selections.
      let layerTopologySelection =
        nextLayerTopologiesBySources.get(sourceSetKey) ??
        this.layerTopologiesBySources.get(sourceSetKey)
      if (!layerTopologySelection) {
        layerTopologySelection = getLayerTopologiesForCoveredNodes({
          coveringNodes,
          nodeGroups: this.inputProblem.nodeGroups,
          layerCount: this.inputProblem.layerCount,
          allowBlindAndBuriedVias: this.inputProblem.allowBlindAndBuriedVias,
        })
      }
      nextLayerTopologiesBySources.set(sourceSetKey, layerTopologySelection)
      const { layerTopologies, overruledTargetSourceKeys } =
        layerTopologySelection
      for (const sourceKey of overruledTargetSourceKeys) {
        this.overruledTargetSourceKeys.add(sourceKey)
      }
      if (layerTopologies.length === 0) continue

      let minYPrecisionKey = this.yPrecisionKeyByCoordinate.get(minY)
      if (minYPrecisionKey === undefined) {
        minYPrecisionKey = minY.toPrecision(15)
        this.yPrecisionKeyByCoordinate.set(minY, minYPrecisionKey)
      }
      let maxYPrecisionKey = this.yPrecisionKeyByCoordinate.get(maxY)
      if (maxYPrecisionKey === undefined) {
        maxYPrecisionKey = maxY.toPrecision(15)
        this.yPrecisionKeyByCoordinate.set(maxY, maxYPrecisionKey)
      }
      const ySpanKey = `${minYPrecisionKey}\0${maxYPrecisionKey}`
      for (const layerTopology of layerTopologies) {
        const mergeKey = `${layerTopology.availableZ.join(",")}\0${layerTopology.topologySignature}`
        const bucketKey = `${mergeKey}\0${ySpanKey}`
        const previousRegion =
          nextHorizontalRegionByBucket.get(bucketKey) ??
          this.horizontalRegionByBucket.get(bucketKey)
        // Perform the existing first horizontal compaction as slabs arrive.
        // Layer signatures must match; keep the same combined provenance.
        if (
          previousRegion &&
          Math.abs(previousRegion.bounds.maxX - minX) <=
            TOPOLOGY_MERGING_EPSILON
        ) {
          if (previousRegion.topologyMode === "free") {
            previousRegion.sourceKeys = [
              ...new Set([
                ...previousRegion.sourceKeys,
                ...layerTopology.sourceKeys,
              ]),
            ].sort()
          }
          previousRegion.bounds.maxX = maxX
          nextHorizontalRegionByBucket.set(bucketKey, previousRegion)
        } else {
          const region: TopologyMergingRegion = {
            bounds: { minX, maxX, minY, maxY },
            availableZ: layerTopology.availableZ,
            sourceKeys: layerTopology.sourceKeys,
            topologyMode: layerTopology.topologyMode,
            topologySignature: layerTopology.topologySignature,
            mergeKey,
          }
          this.atomicRegions.push(region)
          this.totalCreatedAtomicRegionCount += 1
          nextHorizontalRegionByBucket.set(bucketKey, region)
        }
      }
    }
    this.horizontalRegionByBucket = nextHorizontalRegionByBucket
    this.layerTopologiesBySources = nextLayerTopologiesBySources
    if (this.atomicRegions.length >= this.nextCompactionThreshold) {
      const compactedRegions = compactClosedAtomicRegions({
        regions: this.atomicRegions,
        openRegions: new Set(this.horizontalRegionByBucket.values()),
        preparedNodeBySourceKey: this.preparedNodeBySourceKey,
        completedBeforeX: maxX,
      })
      this.atomicRegions.length = 0
      for (const compactedRegion of compactedRegions) {
        this.atomicRegions.push(compactedRegion)
      }
      this.nextCompactionThreshold = Math.max(
        RETAINED_ATOMIC_REGION_COMPACTION_THRESHOLD,
        this.atomicRegions.length + RETAINED_ATOMIC_REGION_COMPACTION_STEP,
      )
    }
  }
}
