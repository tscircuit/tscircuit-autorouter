import type { Bounds } from "@tscircuit/math-utils"
import type {
  PreparedTopologyMergingNode,
  TopologyMergingLayerTopology,
  TopologyMergingMode,
  TopologyMergingNodeGroup,
  TopologyMergingRegion,
} from "./topology-merging-types"
import { TOPOLOGY_MERGING_EPSILON } from "./topology-merging-types"

const ALIGNED_VIA_TOPOLOGY_MODE = "aligned-via"
const ALIGNED_VIA_SIGNATURE_PREFIX = `{"mode":"${ALIGNED_VIA_TOPOLOGY_MODE}",`

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

const getTargetConnectionAliases = (
  preparedNode: PreparedTopologyMergingNode,
): string[] => [
  ...(preparedNode.node._targetConnectionName
    ? [preparedNode.node._targetConnectionName]
    : []),
  ...(preparedNode.node._connectedTo ?? []),
]

const doPreparedNodeBoundsOverlap = (
  first: PreparedTopologyMergingNode,
  second: PreparedTopologyMergingNode,
): boolean =>
  Math.max(first.bounds.minX, second.bounds.minX) <
    Math.min(first.bounds.maxX, second.bounds.maxX) - TOPOLOGY_MERGING_EPSILON &&
  Math.max(first.bounds.minY, second.bounds.minY) <
    Math.min(first.bounds.maxY, second.bounds.maxY) - TOPOLOGY_MERGING_EPSILON

export function getCrossLayerTargetAccessLayers(
  preparedNodes: PreparedTopologyMergingNode[],
): Map<string, number[]> {
  const targetNodes = preparedNodes.filter(
    ({ node }) => node._containsObstacle && node._containsTarget,
  )
  const accessLayersBySourceKey = new Map<string, number[]>()

  for (const targetNode of targetNodes) {
    const targetAliases = new Set(getTargetConnectionAliases(targetNode))
    const accessLayers = new Set(targetNode.node.availableZ)

    for (const candidate of targetNodes) {
      if (
        candidate === targetNode ||
        !doPreparedNodeBoundsOverlap(targetNode, candidate) ||
        !getTargetConnectionAliases(candidate).some((alias) =>
          targetAliases.has(alias),
        )
      ) {
        continue
      }
      for (const z of candidate.node.availableZ) accessLayers.add(z)
    }

    if (accessLayers.size > targetNode.node.availableZ.length) {
      accessLayersBySourceKey.set(
        targetNode.sourceKey,
        [...accessLayers].sort((a, b) => a - b),
      )
    }
  }

  return accessLayersBySourceKey
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

export function mergeViaCompatibleLayerTopologies({
  layerTopologies,
  canUseSourceAsFreeSpace,
  getTargetAccessLayers,
}: {
  layerTopologies: TopologyMergingLayerTopology[]
  canUseSourceAsFreeSpace: (sourceKey: string) => boolean
  getTargetAccessLayers: (sourceKey: string) => number[] | undefined
}): TopologyMergingLayerTopology[] {
  const topologyCountByLayer = new Map<number, number>()
  for (const topology of layerTopologies) {
    for (const z of topology.availableZ) {
      topologyCountByLayer.set(z, (topologyCountByLayer.get(z) ?? 0) + 1)
    }
  }

  const compatibleTopologies = layerTopologies.flatMap((topology) => {
    const hasContiguousLayers = topology.availableZ.every(
      (z, index) => index === 0 || z === topology.availableZ[index - 1]! + 1,
    )
    const hasExclusiveLayers = topology.availableZ.every(
      (z) => topologyCountByLayer.get(z) === 1,
    )
    if (
      !hasContiguousLayers ||
      !hasExclusiveLayers ||
      topology.sourceKeys.length === 0
    ) {
      return []
    }

    const isFree = topology.sourceKeys.every(canUseSourceAsFreeSpace)
    const targetAccessLayers =
      topology.topologyMode === "target-passthrough" &&
      topology.sourceKeys.length === 1
        ? getTargetAccessLayers(topology.sourceKeys[0]!)
        : undefined
    const isTarget = targetAccessLayers !== undefined
    return isFree || isTarget
      ? [
          {
            topology,
            targetSourceKeys: isTarget ? topology.sourceKeys : [],
            targetAccessLayers: targetAccessLayers ?? [],
          },
        ]
      : []
  })
  if (compatibleTopologies.length < 2) return layerTopologies

  const compatibleTopologySet = new Set(
    compatibleTopologies.map(({ topology }) => topology),
  )
  const incompatibleTopologies = layerTopologies.filter(
    (topology) => !compatibleTopologySet.has(topology),
  )
  const sortedTopologies = [...compatibleTopologies].sort(
    (a, b) => a.topology.availableZ[0]! - b.topology.availableZ[0]!,
  )
  const topologyRuns: typeof compatibleTopologies[] = []

  for (const item of sortedTopologies) {
    const currentRun = topologyRuns[topologyRuns.length - 1]
    const currentMaxZ = currentRun
      ? Math.max(
          ...currentRun.flatMap(({ topology }) => topology.availableZ),
        )
      : Number.NEGATIVE_INFINITY
    const nextMinZ = Math.min(...item.topology.availableZ)
    const currentRunHasTarget = currentRun?.some(
      ({ targetSourceKeys }) => targetSourceKeys.length > 0,
    )
    const nextIsTarget = item.targetSourceKeys.length > 0
    if (
      currentRun &&
      nextMinZ === currentMaxZ + 1 &&
      !(currentRunHasTarget && nextIsTarget)
    ) {
      currentRun.push(item)
    } else {
      topologyRuns.push([item])
    }
  }

  const mergedTopologies = topologyRuns.flatMap((run) => {
    if (run.length === 1) return [run[0]!.topology]

    const targetItem = run.find(
      ({ targetSourceKeys }) => targetSourceKeys.length > 0,
    )
    const clearanceZ = [
      ...new Set(run.flatMap(({ topology }) => topology.availableZ)),
    ].sort((a, b) => a - b)
    const targetAccessZ = targetItem
      ? targetItem.targetAccessLayers.filter((z) => clearanceZ.includes(z))
      : clearanceZ
    if (
      targetItem &&
      !targetAccessZ.some(
        (z) => !targetItem.topology.availableZ.includes(z),
      )
    ) {
      return run.map(({ topology }) => topology)
    }

    const sourceKeys = [
      ...new Set(run.flatMap(({ topology }) => topology.sourceKeys)),
    ].sort()
    const targetSourceKeys = [...(targetItem?.targetSourceKeys ?? [])].sort()
    const topologyMode = sourceKeys.length === 1 ? "passthrough" : "merged"
    return [
      {
        availableZ: clearanceZ,
        sourceKeys,
        topologyMode,
        topologySignature: JSON.stringify({
          mode: ALIGNED_VIA_TOPOLOGY_MODE,
          targetSourceKeys,
          targetAccessZ,
          clearanceZ,
        }),
      } satisfies TopologyMergingLayerTopology,
    ]
  })

  return [...incompatibleTopologies, ...mergedTopologies].sort(
    (a, b) => a.availableZ[0]! - b.availableZ[0]!,
  )
}

export function finalizeAlignedViaRegions({
  regions,
  minimumViaFootprint,
  preparedNodeBySourceKey,
}: {
  regions: TopologyMergingRegion[]
  minimumViaFootprint: number
  preparedNodeBySourceKey: ReadonlyMap<string, PreparedTopologyMergingNode>
}): TopologyMergingRegion[] {
  return regions.flatMap((region) => {
    const isAlignedViaRegion = region.topologySignature.startsWith(
      ALIGNED_VIA_SIGNATURE_PREFIX,
    )
    if (!isAlignedViaRegion) return [region]

    const { targetSourceKeys, targetAccessZ, clearanceZ } = JSON.parse(
      region.topologySignature,
    ) as {
      targetSourceKeys: string[]
      targetAccessZ: number[]
      clearanceZ: number[]
    }
    const width = region.bounds.maxX - region.bounds.minX
    const height = region.bounds.maxY - region.bounds.minY
    if (Math.min(width, height) >= minimumViaFootprint) {
      return [{ ...region, availableZ: targetAccessZ }]
    }

    const targetSourceKeySet = new Set(targetSourceKeys)

    return clearanceZ.map((z) => {
      const sourceKeys = region.sourceKeys.filter((sourceKey) =>
        preparedNodeBySourceKey.get(sourceKey)?.node.availableZ.includes(z),
      )
      if (sourceKeys.length === 0) {
        throw new Error(
          `TopologyMergingSolver: aligned via region lost layer ${z} provenance`,
        )
      }
      const targetKeysOnLayer = sourceKeys.filter((sourceKey) =>
        targetSourceKeySet.has(sourceKey),
      )
      const outputSourceKeys =
        targetKeysOnLayer.length > 0 ? targetKeysOnLayer : sourceKeys
      const topologyMode =
        targetKeysOnLayer.length > 0
          ? targetKeysOnLayer.length === 1
            ? "target-passthrough"
            : "target-merged"
          : outputSourceKeys.length === 1
            ? "passthrough"
            : "merged"
      return {
        bounds: { ...region.bounds },
        availableZ: [z],
        sourceKeys: outputSourceKeys,
        topologyMode,
        topologySignature: JSON.stringify({
          mode: topologyMode,
          sourceKeys: outputSourceKeys,
        }),
      } satisfies TopologyMergingRegion
    })
  })
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
    previousRegion.sourceKeys = [
      ...new Set([...previousRegion.sourceKeys, ...region.sourceKeys]),
    ].sort()
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
