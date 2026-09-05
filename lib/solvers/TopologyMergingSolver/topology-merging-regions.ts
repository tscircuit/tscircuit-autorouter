import type { Bounds } from "@tscircuit/math-utils"
import type {
  PreparedTopologyMergingNode,
  TopologyMergingLayerTopology,
  TopologyMergingMode,
  TopologyMergingNodeGroup,
  TopologyMergingRegion,
} from "./topology-merging-types"
import { TOPOLOGY_MERGING_EPSILON } from "./topology-merging-types"

export function getCanonicalCoordinates(values: number[]): number[] {
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

export function getLayerTopologiesForCoveredNodes({
  coveringNodes,
  nodeGroups,
  layerCount,
}: {
  coveringNodes: PreparedTopologyMergingNode[]
  nodeGroups: readonly TopologyMergingNodeGroup[]
  layerCount: number
}): TopologyMergingLayerTopology[] {
  const layerTopologyBySignature = new Map<
    string,
    TopologyMergingLayerTopology
  >()
  for (let z = 0; z < layerCount; z++) {
    const nodesOnLayer = coveringNodes
      .filter(({ node }) => node.availableZ.includes(z))
      .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
    if (nodesOnLayer.length === 0) continue

    const activeGroupIndexes = new Set(
      nodesOnLayer.map(({ groupIndex }) => groupIndex),
    )
    const targetObstacleNodes = nodesOnLayer.filter(
      ({ node }) => node._containsObstacle && node._containsTarget,
    )
    const globalTargetObstacleNodes = targetObstacleNodes.filter(
      ({ groupIndex }) => !nodeGroups[groupIndex]!.isComponent,
    )
    const targetGroupIndexes = new Set(
      targetObstacleNodes.map(({ groupIndex }) => groupIndex),
    )
    const topologyMode: TopologyMergingMode =
      targetObstacleNodes.length > 0
        ? globalTargetObstacleNodes.length > 0 || targetGroupIndexes.size === 1
          ? "target-passthrough"
          : "target-merged"
        : activeGroupIndexes.size === 1
          ? "passthrough"
          : "merged"
    const sourceKeyGroups = getSourceKeyGroupsForTopologyMode({
      topologyMode,
      nodesOnLayer,
      targetObstacleNodes,
      globalTargetObstacleNodes,
    })

    for (const sourceKeys of sourceKeyGroups) {
      const topologySignature = JSON.stringify({
        mode: topologyMode,
        sourceKeys,
      })
      const existingTopology = layerTopologyBySignature.get(topologySignature)
      if (existingTopology) {
        existingTopology.availableZ.push(z)
      } else {
        layerTopologyBySignature.set(topologySignature, {
          availableZ: [z],
          sourceKeys,
          topologyMode,
          topologySignature,
        })
      }
    }
  }

  return [...layerTopologyBySignature.values()]
}

export function restoreAuthoritativeTargetRegions({
  regions,
  preparedNodeBySourceKey,
}: {
  regions: TopologyMergingRegion[]
  preparedNodeBySourceKey: ReadonlyMap<string, PreparedTopologyMergingNode>
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
        ([, topologyModes]) =>
          topologyModes.size === 1 && topologyModes.has("target-passthrough"),
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
  return JSON.stringify({
    availableZ: region.availableZ,
    topologySignature: region.topologySignature,
  })
}

function getHorizontalMergeBucketKey(region: TopologyMergingRegion): string {
  return JSON.stringify({
    mergeKey: getRegionMergeKey(region),
    minY: region.bounds.minY.toPrecision(15),
    maxY: region.bounds.maxY.toPrecision(15),
  })
}

function getVerticalMergeBucketKey(region: TopologyMergingRegion): string {
  return JSON.stringify({
    mergeKey: getRegionMergeKey(region),
    minX: region.bounds.minX.toPrecision(15),
    maxX: region.bounds.maxX.toPrecision(15),
  })
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
    const bucket = regionsByMergeBucket.get(bucketKey) ?? []
    bucket.push(region)
    regionsByMergeBucket.set(bucketKey, bucket)
  }

  return [...regionsByMergeBucket.values()].flatMap((bucket) =>
    mergeRegionRun(bucket, direction),
  )
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

function getSourceKeyGroupsForTopologyMode({
  topologyMode,
  nodesOnLayer,
  targetObstacleNodes,
  globalTargetObstacleNodes,
}: {
  topologyMode: TopologyMergingMode
  nodesOnLayer: PreparedTopologyMergingNode[]
  targetObstacleNodes: PreparedTopologyMergingNode[]
  globalTargetObstacleNodes: PreparedTopologyMergingNode[]
}): string[][] {
  if (topologyMode === "target-passthrough") {
    const authoritativeNodes =
      globalTargetObstacleNodes.length > 0
        ? globalTargetObstacleNodes
        : targetObstacleNodes
    return authoritativeNodes.map(({ sourceKey }) => [sourceKey])
  }
  if (topologyMode === "target-merged") {
    return [targetObstacleNodes.map(({ sourceKey }) => sourceKey).sort()]
  }
  if (topologyMode === "passthrough") {
    return nodesOnLayer.map(({ sourceKey }) => [sourceKey])
  }
  return [nodesOnLayer.map(({ sourceKey }) => sourceKey).sort()]
}
