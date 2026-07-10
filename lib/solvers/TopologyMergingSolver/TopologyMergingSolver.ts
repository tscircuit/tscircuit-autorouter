import type { Bounds } from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNode } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import {
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
  isValidCapacityBounds,
} from "../TopologyPlanningSolver/capacity-node-geometry"

const TOPOLOGY_MERGING_EPSILON = 1e-5

export interface TopologyMergingNodeGroup {
  groupId: string
  nodes: CapacityMeshNode[]
  isComponent: boolean
}

export interface TopologyMergingSolverParams {
  nodeGroups: readonly TopologyMergingNodeGroup[]
  layerCount: number
}

type PreparedNode = {
  sourceKey: string
  groupIndex: number
  node: CapacityMeshNode
  bounds: Bounds
}

type TopologyRegion = {
  bounds: Bounds
  availableZ: number[]
  sourceKeys: string[]
  topologySignature: string
}

type LayerTopology = {
  availableZ: number[]
  sourceKeys: string[]
  topologySignature: string
}

type RegionMetadata = Pick<
  CapacityMeshNode,
  | "_containsObstacle"
  | "_completelyInsideObstacle"
  | "_containsTarget"
  | "_targetConnectionName"
  | "_isVirtualOffboard"
  | "_offboardNetName"
  | "_offBoardConnectionId"
  | "_offBoardConnectedCapacityMeshNodeIds"
  | "_qfpRegionType"
  | "_isNarrowQfpPadGap"
  | "_soicRegionType"
  | "_isComponentTopologyNode"
>

function getCanonicalCoordinates(values: number[]): number[] {
  const sortedValues = [...values].sort((a, b) => a - b)
  const coordinates: number[] = []

  for (const value of sortedValues) {
    const previousValue = coordinates[coordinates.length - 1]
    if (
      previousValue === undefined ||
      Math.abs(value - previousValue) > TOPOLOGY_MERGING_EPSILON
    ) {
      coordinates.push(value)
    }
  }

  return coordinates
}

function doesBoundsContainPoint(
  bounds: Bounds,
  point: { x: number; y: number },
): boolean {
  return (
    point.x >= bounds.minX - TOPOLOGY_MERGING_EPSILON &&
    point.x <= bounds.maxX + TOPOLOGY_MERGING_EPSILON &&
    point.y >= bounds.minY - TOPOLOGY_MERGING_EPSILON &&
    point.y <= bounds.maxY + TOPOLOGY_MERGING_EPSILON
  )
}

function getRegionMergeKey(region: TopologyRegion): string {
  return JSON.stringify({
    availableZ: region.availableZ,
    topologySignature: region.topologySignature,
  })
}

function getCoordinateKey(value: number): string {
  return value.toPrecision(15)
}

function getHorizontalMergeBucketKey(region: TopologyRegion): string {
  return JSON.stringify({
    mergeKey: getRegionMergeKey(region),
    minY: getCoordinateKey(region.bounds.minY),
    maxY: getCoordinateKey(region.bounds.maxY),
  })
}

function getVerticalMergeBucketKey(region: TopologyRegion): string {
  return JSON.stringify({
    mergeKey: getRegionMergeKey(region),
    minX: getCoordinateKey(region.bounds.minX),
    maxX: getCoordinateKey(region.bounds.maxX),
  })
}

function mergeRegionRun(
  regions: TopologyRegion[],
  direction: "horizontal" | "vertical",
): TopologyRegion[] {
  const sortedRegions = [...regions].sort((a, b) =>
    direction === "horizontal"
      ? a.bounds.minX - b.bounds.minX
      : a.bounds.minY - b.bounds.minY,
  )
  const mergedRegions: TopologyRegion[] = []

  for (const region of sortedRegions) {
    const previousRegion = mergedRegions[mergedRegions.length - 1]
    const regionsTouch =
      previousRegion !== undefined &&
      (direction === "horizontal"
        ? Math.abs(previousRegion.bounds.maxX - region.bounds.minX) <=
          TOPOLOGY_MERGING_EPSILON
        : Math.abs(previousRegion.bounds.maxY - region.bounds.minY) <=
          TOPOLOGY_MERGING_EPSILON)

    if (!previousRegion || !regionsTouch) {
      mergedRegions.push({
        ...region,
        bounds: { ...region.bounds },
        availableZ: [...region.availableZ],
        sourceKeys: [...region.sourceKeys],
      })
      continue
    }

    if (direction === "horizontal") {
      previousRegion.bounds.maxX = region.bounds.maxX
    } else {
      previousRegion.bounds.maxY = region.bounds.maxY
    }
  }

  return mergedRegions
}

function compactRegionsInDirection(
  regions: TopologyRegion[],
  direction: "horizontal" | "vertical",
): TopologyRegion[] {
  const regionsByMergeBucket = new Map<string, TopologyRegion[]>()

  for (const region of regions) {
    const bucketKey =
      direction === "horizontal"
        ? getHorizontalMergeBucketKey(region)
        : getVerticalMergeBucketKey(region)
    const bucket = regionsByMergeBucket.get(bucketKey) ?? []
    bucket.push(region)
    regionsByMergeBucket.set(bucketKey, bucket)
  }

  return [...regionsByMergeBucket.values()].flatMap((bucket) =>
    mergeRegionRun(bucket, direction),
  )
}

function compactTopologyRegions(regions: TopologyRegion[]): TopologyRegion[] {
  let compactedRegions = regions

  while (true) {
    const horizontallyCompacted = compactRegionsInDirection(
      compactedRegions,
      "horizontal",
    )
    const verticallyCompacted = compactRegionsInDirection(
      horizontallyCompacted,
      "vertical",
    )

    if (verticallyCompacted.length === compactedRegions.length) {
      return verticallyCompacted
    }

    compactedRegions = verticallyCompacted
  }
}

function getUniqueOptionalValue<T>(
  values: Array<T | undefined>,
  fieldName: string,
  sourceNodeIds: string[],
): T | undefined {
  const definedValues = Array.from(
    new Set(values.filter((value): value is T => value !== undefined)),
  )

  if (definedValues.length > 1) {
    throw new Error(
      `TopologyMergingSolver: conflicting ${fieldName} values for overlapping source nodes ${sourceNodeIds.join(", ")}`,
    )
  }

  return definedValues[0]
}

function getAgreedOptionalValue<T>(
  values: Array<T | undefined>,
): T | undefined {
  const definedValues = Array.from(
    new Set(values.filter((value): value is T => value !== undefined)),
  )

  return definedValues.length === 1 ? definedValues[0] : undefined
}

function getRegionMetadata({
  sourceNodes,
  isComponentTopologyNode,
}: {
  sourceNodes: CapacityMeshNode[]
  isComponentTopologyNode: boolean
}): RegionMetadata {
  const sourceNodeIds = sourceNodes.map((node) => node.capacityMeshNodeId)
  const targetConnectionName = getUniqueOptionalValue(
    sourceNodes.map((node) => node._targetConnectionName),
    "target connection",
    sourceNodeIds,
  )
  const offBoardConnectionId = getUniqueOptionalValue(
    sourceNodes.map((node) => node._offBoardConnectionId),
    "off-board connection",
    sourceNodeIds,
  )
  const offboardNetName = getUniqueOptionalValue(
    sourceNodes.map((node) => node._offboardNetName),
    "off-board net",
    sourceNodeIds,
  )
  const offBoardConnectedCapacityMeshNodeIds = Array.from(
    new Set(
      sourceNodes.flatMap(
        (node) => node._offBoardConnectedCapacityMeshNodeIds ?? [],
      ),
    ),
  )

  return {
    _containsObstacle:
      sourceNodes.some((node) => node._containsObstacle) || undefined,
    _completelyInsideObstacle:
      sourceNodes.some((node) => node._completelyInsideObstacle) || undefined,
    _containsTarget:
      sourceNodes.some((node) => node._containsTarget) || undefined,
    _targetConnectionName: targetConnectionName,
    _isVirtualOffboard:
      sourceNodes.some((node) => node._isVirtualOffboard) || undefined,
    _offboardNetName: offboardNetName,
    _offBoardConnectionId: offBoardConnectionId,
    _offBoardConnectedCapacityMeshNodeIds:
      offBoardConnectedCapacityMeshNodeIds.length > 0
        ? offBoardConnectedCapacityMeshNodeIds
        : undefined,
    _qfpRegionType: getAgreedOptionalValue(
      sourceNodes.map((node) => node._qfpRegionType),
    ),
    _isNarrowQfpPadGap:
      sourceNodes.some((node) => node._isNarrowQfpPadGap) || undefined,
    _soicRegionType: getAgreedOptionalValue(
      sourceNodes.map((node) => node._soicRegionType),
    ),
    _isComponentTopologyNode: isComponentTopologyNode || undefined,
  }
}

function doBoundsMatch(a: Bounds, b: Bounds): boolean {
  return (
    Math.abs(a.minX - b.minX) <= TOPOLOGY_MERGING_EPSILON &&
    Math.abs(a.maxX - b.maxX) <= TOPOLOGY_MERGING_EPSILON &&
    Math.abs(a.minY - b.minY) <= TOPOLOGY_MERGING_EPSILON &&
    Math.abs(a.maxY - b.maxY) <= TOPOLOGY_MERGING_EPSILON
  )
}

function doLayersMatch(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((z, index) => z === b[index])
}

export class TopologyMergingSolver extends BaseSolver {
  private readonly preparedNodes: PreparedNode[] = []
  private readonly preparedNodeBySourceKey = new Map<string, PreparedNode>()
  private readonly xCoordinates: number[]
  private readonly atomicRegions: TopologyRegion[] = []
  private outputNodes: CapacityMeshNode[] = []
  private currentXIndex = 0

  constructor(public readonly inputProblem: TopologyMergingSolverParams) {
    super()
    this.MAX_ITERATIONS = 100_000
    this.validateInput()

    for (
      let groupIndex = 0;
      groupIndex < this.inputProblem.nodeGroups.length;
      groupIndex++
    ) {
      const group = this.inputProblem.nodeGroups[groupIndex]!
      for (const node of group.nodes) {
        const preparedNode: PreparedNode = {
          sourceKey: `${group.groupId}:${node.capacityMeshNodeId}`,
          groupIndex,
          node,
          bounds: getCapacityMeshNodeBounds(node),
        }
        this.preparedNodes.push(preparedNode)
        this.preparedNodeBySourceKey.set(preparedNode.sourceKey, preparedNode)
      }
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
    }
  }

  override getConstructorParams(): [TopologyMergingSolverParams] {
    return [this.inputProblem]
  }

  override _step(): void {
    if (this.currentXIndex < this.xCoordinates.length - 1) {
      this.processCurrentXSlab()
      this.currentXIndex += 1
      this.stats.processedXSlabCount = this.currentXIndex
      this.stats.atomicRegionCount = this.atomicRegions.length
      return
    }

    const compactedRegions = compactTopologyRegions(this.atomicRegions)
    this.outputNodes = this.createOutputNodes(compactedRegions)
    this.validateOutput(this.outputNodes)
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
      : this.createOutputNodes(this.atomicRegions, false)

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

  private validateInput(): void {
    if (!Number.isInteger(this.inputProblem.layerCount)) {
      throw new Error("TopologyMergingSolver: layerCount must be an integer")
    }
    if (this.inputProblem.layerCount <= 0) {
      throw new Error("TopologyMergingSolver: layerCount must be positive")
    }
    if (this.inputProblem.nodeGroups.length === 0) {
      throw new Error(
        "TopologyMergingSolver: at least one node group is required",
      )
    }

    const groupIds = new Set<string>()
    let nodeCount = 0
    for (const group of this.inputProblem.nodeGroups) {
      if (groupIds.has(group.groupId)) {
        throw new Error(
          `TopologyMergingSolver: duplicate topology group id "${group.groupId}"`,
        )
      }
      groupIds.add(group.groupId)
      nodeCount += group.nodes.length
      if (group.nodes.length === 0) {
        throw new Error(
          `TopologyMergingSolver: topology group "${group.groupId}" is empty`,
        )
      }

      const nodeIds = new Set<string>()
      for (const node of group.nodes) {
        if (nodeIds.has(node.capacityMeshNodeId)) {
          throw new Error(
            `TopologyMergingSolver: duplicate node id "${node.capacityMeshNodeId}" in group "${group.groupId}"`,
          )
        }
        nodeIds.add(node.capacityMeshNodeId)
        this.validateInputNode(node, group.groupId)
      }
    }

    if (nodeCount === 0) {
      throw new Error("TopologyMergingSolver: topology node groups are empty")
    }
  }

  private validateInputNode(node: CapacityMeshNode, groupId: string): void {
    if (!isValidCapacityBounds(getCapacityMeshNodeBounds(node))) {
      throw new Error(
        `TopologyMergingSolver: node "${node.capacityMeshNodeId}" in group "${groupId}" has invalid bounds`,
      )
    }
    if (node.availableZ.length === 0) {
      throw new Error(
        `TopologyMergingSolver: node "${node.capacityMeshNodeId}" in group "${groupId}" has no available layers`,
      )
    }

    const sortedAvailableZ = [...new Set(node.availableZ)].sort((a, b) => a - b)
    const hasInvalidLayer = sortedAvailableZ.some(
      (z) => !Number.isInteger(z) || z < 0 || z >= this.inputProblem.layerCount,
    )
    if (hasInvalidLayer || !doLayersMatch(sortedAvailableZ, node.availableZ)) {
      throw new Error(
        `TopologyMergingSolver: node "${node.capacityMeshNodeId}" in group "${groupId}" has invalid or unsorted availableZ`,
      )
    }
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

      const layerTopologies = this.getLayerTopologies(coveringNodes)
      for (const layerTopology of layerTopologies) {
        this.atomicRegions.push({
          bounds: { minX, maxX, minY, maxY },
          availableZ: layerTopology.availableZ,
          sourceKeys: layerTopology.sourceKeys,
          topologySignature: layerTopology.topologySignature,
        })
      }
    }
  }

  private getLayerTopologies(coveringNodes: PreparedNode[]): LayerTopology[] {
    const coveringNodesByGroup = new Map<number, PreparedNode[]>()
    for (const preparedNode of coveringNodes) {
      const groupNodes = coveringNodesByGroup.get(preparedNode.groupIndex) ?? []
      groupNodes.push(preparedNode)
      coveringNodesByGroup.set(preparedNode.groupIndex, groupNodes)
    }

    const layerTopologyBySignature = new Map<string, LayerTopology>()
    for (let z = 0; z < this.inputProblem.layerCount; z++) {
      const sourceKeys = [...coveringNodesByGroup.values()]
        .flatMap((groupNodes) =>
          groupNodes
            .filter(({ node }) => node.availableZ.includes(z))
            .map(({ sourceKey }) => sourceKey),
        )
        .sort()
      if (sourceKeys.length === 0) continue

      const topologySignature = JSON.stringify(sourceKeys)
      const existingTopology = layerTopologyBySignature.get(topologySignature)
      if (existingTopology) {
        existingTopology.availableZ.push(z)
      } else {
        layerTopologyBySignature.set(topologySignature, {
          availableZ: [z],
          sourceKeys,
          topologySignature,
        })
      }
    }

    return [...layerTopologyBySignature.values()]
  }

  private createOutputNodes(
    regions: TopologyRegion[],
    preserveSourceIds = true,
  ): CapacityMeshNode[] {
    const sortedRegions = [...regions].sort(
      (a, b) =>
        a.bounds.minX - b.bounds.minX ||
        a.bounds.minY - b.bounds.minY ||
        a.bounds.maxX - b.bounds.maxX ||
        a.bounds.maxY - b.bounds.maxY ||
        a.availableZ[0]! - b.availableZ[0]!,
    )
    const usedNodeIds = new Set<string>()

    return sortedRegions.map((region, regionIndex) => {
      const sourcePreparedNodes = region.sourceKeys.map((sourceKey) => {
        const preparedNode = this.preparedNodeBySourceKey.get(sourceKey)
        if (!preparedNode) {
          throw new Error(
            `TopologyMergingSolver: missing source node for "${sourceKey}"`,
          )
        }
        return preparedNode
      })
      const sourceNodes = sourcePreparedNodes.map(({ node }) => node)
      const isComponentTopologyNode = sourcePreparedNodes.some(
        ({ groupIndex }) =>
          this.inputProblem.nodeGroups[groupIndex]!.isComponent,
      )
      const metadata = getRegionMetadata({
        sourceNodes,
        isComponentTopologyNode,
      })
      const preservedSourceNode =
        preserveSourceIds && sourcePreparedNodes.length === 1
          ? sourcePreparedNodes[0]!.node
          : null
      const canPreserveSourceId = Boolean(
        preservedSourceNode &&
          doBoundsMatch(
            region.bounds,
            getCapacityMeshNodeBounds(preservedSourceNode),
          ) &&
          doLayersMatch(region.availableZ, preservedSourceNode.availableZ) &&
          !usedNodeIds.has(preservedSourceNode.capacityMeshNodeId),
      )
      let capacityMeshNodeId = canPreserveSourceId
        ? preservedSourceNode!.capacityMeshNodeId
        : `topology_merge_${regionIndex}`
      while (usedNodeIds.has(capacityMeshNodeId)) {
        capacityMeshNodeId = `${capacityMeshNodeId}_next`
      }
      usedNodeIds.add(capacityMeshNodeId)

      return {
        ...(preservedSourceNode ?? sourceNodes[0]),
        ...metadata,
        capacityMeshNodeId,
        center: {
          x: (region.bounds.minX + region.bounds.maxX) / 2,
          y: (region.bounds.minY + region.bounds.maxY) / 2,
        },
        width: region.bounds.maxX - region.bounds.minX,
        height: region.bounds.maxY - region.bounds.minY,
        layer: `z${region.availableZ.join(",")}`,
        availableZ: [...region.availableZ],
        _adjacentNodeIds: undefined,
        _parent: undefined,
        _strawNode: undefined,
        _strawParentCapacityMeshNodeId: undefined,
      }
    })
  }

  private validateOutput(nodes: CapacityMeshNode[]): void {
    const nodeIds = new Set<string>()
    for (const node of nodes) {
      if (nodeIds.has(node.capacityMeshNodeId)) {
        throw new Error(
          `TopologyMergingSolver: duplicate output node id "${node.capacityMeshNodeId}"`,
        )
      }
      nodeIds.add(node.capacityMeshNodeId)

      if (!isValidCapacityBounds(getCapacityMeshNodeBounds(node))) {
        throw new Error(
          `TopologyMergingSolver: output node "${node.capacityMeshNodeId}" has invalid bounds`,
        )
      }
      if (node.availableZ.length === 0) {
        throw new Error(
          `TopologyMergingSolver: output node "${node.capacityMeshNodeId}" has no available layers`,
        )
      }
    }

    for (let aIndex = 0; aIndex < nodes.length; aIndex++) {
      const nodeA = nodes[aIndex]!
      for (let bIndex = aIndex + 1; bIndex < nodes.length; bIndex++) {
        const nodeB = nodes[bIndex]!
        const sharesLayer = nodeA.availableZ.some((z) =>
          nodeB.availableZ.includes(z),
        )
        if (!sharesLayer) continue

        const intersection = getBoundsIntersection(
          getCapacityMeshNodeBounds(nodeA),
          getCapacityMeshNodeBounds(nodeB),
        )
        if (!intersection) continue

        throw new Error(
          `TopologyMergingSolver: output nodes "${nodeA.capacityMeshNodeId}" and "${nodeB.capacityMeshNodeId}" overlap on a shared layer`,
        )
      }
    }
  }
}
