import type { Bounds } from "@tscircuit/math-utils"
import type {
  HorizontalTopologyMergingBucketKey,
  PreparedTopologyMergingNode,
  TopologyMergingLayerTopology,
  TopologyMergingMode,
  TopologyMergingNodeGroup,
  TopologyMergingRegion,
} from "./topology-merging-types"
import { TOPOLOGY_MERGING_EPSILON } from "./topology-merging-types"

export function getCanonicalCoordinates(values: number[]): number[] {
  if (values.length === 0) return []
  const sortedValues = Float64Array.from(values)
  sortedValues.sort()
  const coordinates: number[] = [sortedValues[0]!]

  for (let index = 1; index < sortedValues.length; index++) {
    const value = sortedValues[index]!
    const previousValue = coordinates[coordinates.length - 1]!
    if (Math.abs(value - previousValue) > TOPOLOGY_MERGING_EPSILON) {
      coordinates.push(value)
    }
  }

  return coordinates
}

export function doesBoundsContainPoint(
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

export function compactTopologyMergingRegions(
  regions: TopologyMergingRegion[],
): TopologyMergingRegion[] {
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

export function compactClosedAtomicRegions({
  regions,
  openRegions,
  preparedNodeBySourceKey,
  completedBeforeX,
}: {
  regions: TopologyMergingRegion[]
  openRegions: ReadonlySet<TopologyMergingRegion>
  preparedNodeBySourceKey: ReadonlyMap<string, PreparedTopologyMergingNode>
  completedBeforeX: number
}): TopologyMergingRegion[] {
  const openMergeKeys = new Set<string>()
  for (const openRegion of openRegions) {
    openMergeKeys.add(getRegionMergeKey(openRegion))
  }

  const preservedRegions: TopologyMergingRegion[] = []
  const candidateGroupsByMergeKey = new Map<string, TopologyMergingRegion[]>()
  for (const region of regions) {
    const mergeKey = getRegionMergeKey(region)
    if (
      openRegions.has(region) ||
      region.topologyMode === "target-passthrough" ||
      region.topologyMode === "free" ||
      openMergeKeys.has(mergeKey)
    ) {
      preservedRegions.push(region)
      continue
    }
    let bucket = candidateGroupsByMergeKey.get(mergeKey)
    if (!bucket) {
      bucket = []
      candidateGroupsByMergeKey.set(mergeKey, bucket)
    }
    bucket.push(region)
  }

  const cutoffMaxX = completedBeforeX - TOPOLOGY_MERGING_EPSILON
  for (const bucket of candidateGroupsByMergeKey.values()) {
    if (bucket.length < 2) {
      preservedRegions.push(...bucket)
      continue
    }
    const representativeSourceKeys = bucket[0]!.sourceKeys
    // Non-free signatures embed their exact sourceKeys list, so once any
    // participating source node ends before completedBeforeX, no later X-slab
    // can emit another cell with this mergeKey.
    let isMergeKeyCompleted = false
    for (const sourceKey of representativeSourceKeys) {
      const preparedNode = preparedNodeBySourceKey.get(sourceKey)
      if (preparedNode && preparedNode.bounds.maxX < cutoffMaxX) {
        isMergeKeyCompleted = true
        break
      }
    }
    if (isMergeKeyCompleted) {
      preservedRegions.push(...compactTopologyMergingRegions(bucket))
    } else {
      preservedRegions.push(...bucket)
    }
  }

  return preservedRegions
}

const EMPTY_OVERRULED_SOURCE_KEYS: string[] = []
const scratchNodesOnLayer: PreparedTopologyMergingNode[] = []
const scratchTargetObstacleNodes: PreparedTopologyMergingNode[] = []
const scratchGlobalTargetObstacleNodes: PreparedTopologyMergingNode[] = []

export function getLayerTopologiesForCoveredNodes({
  coveringNodes,
  nodeGroups,
  layerCount,
  allowBlindAndBuriedVias = false,
}: {
  coveringNodes: PreparedTopologyMergingNode[]
  nodeGroups: readonly TopologyMergingNodeGroup[]
  layerCount: number
  allowBlindAndBuriedVias?: boolean
}): {
  layerTopologies: TopologyMergingLayerTopology[]
  overruledTargetSourceKeys: string[]
} {
  let isLocaleOrdered = true
  for (let index = 1; index < coveringNodes.length; index++) {
    const previousRank = coveringNodes[index - 1]!.localeRank
    const currentRank = coveringNodes[index]!.localeRank
    if (
      previousRank === undefined ||
      currentRank === undefined ||
      previousRank > currentRank
    ) {
      isLocaleOrdered = false
      break
    }
  }
  const orderedCoveringNodes = isLocaleOrdered
    ? coveringNodes
    : [...coveringNodes].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))

  const layerTopologyBySignature = new Map<
    string,
    TopologyMergingLayerTopology
  >()
  let overruledTargetSourceKeys: Set<string> | null = null
  const useLayerBitmask = layerCount <= 30
  let previousFreeLayer = -2
  let freeRunStart = 0
  for (let z = 0; z < layerCount; z++) {
    scratchNodesOnLayer.length = 0
    scratchTargetObstacleNodes.length = 0
    scratchGlobalTargetObstacleNodes.length = 0
    let firstActiveGroupIndex = -1
    let hasMultipleActiveGroups = false
    let firstTargetGroupIndex = -1
    let hasMultipleTargetGroups = false
    let isFreeSpace = allowBlindAndBuriedVias
    const layerBit = useLayerBitmask ? 1 << z : 0

    for (let index = 0; index < orderedCoveringNodes.length; index++) {
      const preparedNode = orderedCoveringNodes[index]!
      const onLayer =
        useLayerBitmask && preparedNode.layerMask !== undefined
          ? (preparedNode.layerMask & layerBit) !== 0
          : preparedNode.node.availableZ.includes(z)
      if (!onLayer) continue

      scratchNodesOnLayer.push(preparedNode)
      if (firstActiveGroupIndex === -1) {
        firstActiveGroupIndex = preparedNode.groupIndex
      } else if (preparedNode.groupIndex !== firstActiveGroupIndex) {
        hasMultipleActiveGroups = true
      }

      const { node } = preparedNode
      if (node._containsObstacle && node._containsTarget) {
        scratchTargetObstacleNodes.push(preparedNode)
        if (!nodeGroups[preparedNode.groupIndex]!.isComponent) {
          scratchGlobalTargetObstacleNodes.push(preparedNode)
        }
        if (firstTargetGroupIndex === -1) {
          firstTargetGroupIndex = preparedNode.groupIndex
        } else if (preparedNode.groupIndex !== firstTargetGroupIndex) {
          hasMultipleTargetGroups = true
        }
      }
      if (
        isFreeSpace &&
        (node._containsObstacle ||
          node._containsTarget ||
          node._isVirtualOffboard)
      ) {
        isFreeSpace = false
      }
    }
    if (scratchNodesOnLayer.length === 0) continue

    const topologyMode: TopologyMergingMode =
      scratchTargetObstacleNodes.length > 0
        ? scratchGlobalTargetObstacleNodes.length > 0 ||
          !hasMultipleTargetGroups
          ? "target-passthrough"
          : "target-merged"
        : !hasMultipleActiveGroups
          ? "passthrough"
          : "merged"
    // Global target obstacles own this layer here, so component targets
    // covering the same point lose it and must not be restored to their full
    // source bounds later.
    if (
      topologyMode === "target-passthrough" &&
      scratchGlobalTargetObstacleNodes.length > 0
    ) {
      for (let index = 0; index < scratchTargetObstacleNodes.length; index++) {
        const { sourceKey, groupIndex } = scratchTargetObstacleNodes[index]!
        if (nodeGroups[groupIndex]!.isComponent) {
          overruledTargetSourceKeys ??= new Set<string>()
          overruledTargetSourceKeys.add(sourceKey)
        }
      }
    }
    if (isFreeSpace) {
      if (z !== previousFreeLayer + 1) freeRunStart = z
      previousFreeLayer = z
    }

    if (
      topologyMode === "target-passthrough" ||
      topologyMode === "passthrough"
    ) {
      const authoritativeNodes =
        topologyMode === "target-passthrough"
          ? scratchGlobalTargetObstacleNodes.length > 0
            ? scratchGlobalTargetObstacleNodes
            : scratchTargetObstacleNodes
          : scratchNodesOnLayer
      for (let index = 0; index < authoritativeNodes.length; index++) {
        const preparedNode = authoritativeNodes[index]!
        const sourceKeys = preparedNode.singleSourceKeys ?? [
          preparedNode.sourceKey,
        ]
        const topologySignature = isFreeSpace
          ? `free:${freeRunStart}`
          : topologyMode === "target-passthrough"
            ? (preparedNode.targetPassthroughSignature ??
              JSON.stringify({ mode: "target-passthrough", sourceKeys }))
            : (preparedNode.passthroughSignature ??
              JSON.stringify({ mode: "passthrough", sourceKeys }))
        const existingTopology = layerTopologyBySignature.get(topologySignature)
        if (existingTopology) {
          if (
            existingTopology.availableZ[
              existingTopology.availableZ.length - 1
            ] !== z
          ) {
            existingTopology.availableZ.push(z)
          }
          if (isFreeSpace) {
            existingTopology.sourceKeys = [
              ...new Set([...existingTopology.sourceKeys, ...sourceKeys]),
            ].sort()
          }
        } else {
          layerTopologyBySignature.set(topologySignature, {
            availableZ: [z],
            sourceKeys,
            topologyMode: isFreeSpace ? "free" : topologyMode,
            topologySignature,
          })
        }
      }
      continue
    }

    const sourceNodesForMode =
      topologyMode === "target-merged"
        ? scratchTargetObstacleNodes
        : scratchNodesOnLayer
    const sourceKeys = sourceNodesForMode
      .map(({ sourceKey }) => sourceKey)
      .sort()
    // Clear space has no source-node boundary. Join its adjacent
    // layers and cells while retaining every source for provenance.
    const topologySignature = isFreeSpace
      ? `free:${freeRunStart}`
      : JSON.stringify({ mode: topologyMode, sourceKeys })
    const existingTopology = layerTopologyBySignature.get(topologySignature)
    if (existingTopology) {
      if (
        existingTopology.availableZ[existingTopology.availableZ.length - 1] !==
        z
      ) {
        existingTopology.availableZ.push(z)
      }
      if (isFreeSpace) {
        existingTopology.sourceKeys = [
          ...new Set([...existingTopology.sourceKeys, ...sourceKeys]),
        ].sort()
      }
    } else {
      layerTopologyBySignature.set(topologySignature, {
        availableZ: [z],
        sourceKeys,
        topologyMode: isFreeSpace ? "free" : topologyMode,
        topologySignature,
      })
    }
  }

  scratchNodesOnLayer.length = 0
  scratchTargetObstacleNodes.length = 0
  scratchGlobalTargetObstacleNodes.length = 0

  return {
    layerTopologies: Array.from(layerTopologyBySignature.values()),
    overruledTargetSourceKeys: overruledTargetSourceKeys
      ? Array.from(overruledTargetSourceKeys)
      : EMPTY_OVERRULED_SOURCE_KEYS,
  }
}

export function restoreAuthoritativeTargetRegions({
  regions,
  preparedNodeBySourceKey,
  overruledTargetSourceKeys,
}: {
  regions: TopologyMergingRegion[]
  preparedNodeBySourceKey: ReadonlyMap<string, PreparedTopologyMergingNode>
  overruledTargetSourceKeys: ReadonlySet<string>
}): TopologyMergingRegion[] {
  const topologyModesBySourceKey = new Map<string, Set<TopologyMergingMode>>()
  for (const region of regions) {
    for (const sourceKey of region.sourceKeys) {
      const topologyModes =
        topologyModesBySourceKey.get(sourceKey) ??
        new Set<TopologyMergingMode>()
      topologyModes.add(region.topologyMode)
      topologyModesBySourceKey.set(sourceKey, topologyModes)
    }
  }

  const restorableSourceKeys = new Set(
    [...topologyModesBySourceKey.entries()]
      .filter(
        ([sourceKey, topologyModes]) =>
          topologyModes.size === 1 &&
          topologyModes.has("target-passthrough") &&
          !overruledTargetSourceKeys.has(sourceKey),
      )
      .map(([sourceKey]) => sourceKey),
  )
  if (restorableSourceKeys.size === 0) return regions

  const retainedRegions = regions.filter(
    (region) =>
      region.topologyMode !== "target-passthrough" ||
      !restorableSourceKeys.has(region.sourceKeys[0]!),
  )
  const restoredRegions = [...restorableSourceKeys].map((sourceKey) => {
    const preparedNode = preparedNodeBySourceKey.get(sourceKey)
    if (!preparedNode) {
      throw new Error(
        `TopologyMergingSolver: missing authoritative target source "${sourceKey}"`,
      )
    }
    return {
      bounds: { ...preparedNode.bounds },
      availableZ: [...preparedNode.node.availableZ],
      sourceKeys: [sourceKey],
      topologyMode: "target-passthrough" as const,
      topologySignature: JSON.stringify({
        mode: "target-passthrough",
        sourceKeys: [sourceKey],
      }),
    }
  })

  return [...retainedRegions, ...restoredRegions]
}

function getRegionMergeKey(region: TopologyMergingRegion): string {
  if (region.mergeKey !== undefined) {
    return region.mergeKey
  }
  const mergeKey = `${region.availableZ.join(",")}\0${region.topologySignature}`
  region.mergeKey = mergeKey
  return mergeKey
}

export function getHorizontalMergeBucketKey(
  region: TopologyMergingRegion,
): HorizontalTopologyMergingBucketKey {
  const mergeKey = getRegionMergeKey(region)
  const minYKey = region.bounds.minY.toPrecision(15)
  const maxYKey = region.bounds.maxY.toPrecision(15)
  return `${mergeKey}\0${minYKey}\0${maxYKey}`
}

function getVerticalMergeBucketKey(region: TopologyMergingRegion): string {
  const mergeKey = getRegionMergeKey(region)
  const minXKey = region.bounds.minX.toPrecision(15)
  const maxXKey = region.bounds.maxX.toPrecision(15)
  return `${mergeKey}\0${minXKey}\0${maxXKey}`
}

function compactRegionsInDirection(
  regions: TopologyMergingRegion[],
  direction: "horizontal" | "vertical",
): TopologyMergingRegion[] {
  const regionsByMergeBucket = new Map<string, TopologyMergingRegion[]>()

  for (const region of regions) {
    const bucketKey =
      direction === "horizontal"
        ? getHorizontalMergeBucketKey(region)
        : getVerticalMergeBucketKey(region)
    let bucket = regionsByMergeBucket.get(bucketKey)
    if (!bucket) {
      bucket = []
      regionsByMergeBucket.set(bucketKey, bucket)
    }
    bucket.push(region)
  }

  const compacted: TopologyMergingRegion[] = []
  for (const bucket of regionsByMergeBucket.values()) {
    if (bucket.length === 1) {
      compacted.push(bucket[0]!)
      continue
    }
    compacted.push(...mergeRegionRun(bucket, direction))
  }
  return compacted
}

function mergeRegionRun(
  regions: TopologyMergingRegion[],
  direction: "horizontal" | "vertical",
): TopologyMergingRegion[] {
  const sortedRegions = [...regions].sort((a, b) =>
    direction === "horizontal"
      ? a.bounds.minX - b.bounds.minX
      : a.bounds.minY - b.bounds.minY,
  )
  const mergedRegions: TopologyMergingRegion[] = []

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
        availableZ:
          region.topologyMode === "free"
            ? [...region.availableZ]
            : region.availableZ,
        sourceKeys:
          region.topologyMode === "free"
            ? [...region.sourceKeys]
            : region.sourceKeys,
      })
      continue
    }

    if (previousRegion.topologyMode === "free") {
      previousRegion.sourceKeys = [
        ...new Set([...previousRegion.sourceKeys, ...region.sourceKeys]),
      ].sort()
    }
    if (direction === "horizontal") {
      previousRegion.bounds.maxX = region.bounds.maxX
    } else {
      previousRegion.bounds.maxY = region.bounds.maxY
    }
  }

  return mergedRegions
}
