import type { CapacityMeshNode } from "lib/types"
import type {
  SerializedTopologyComponentInput,
  TopologyMeshMergeStrategy,
} from "./MultiGraphTopologyPlannerSolver"
import {
  GEOMETRY_EPSILON,
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
} from "./capacity-node-geometry"
import { getGlobalMeshNodesForMergedTopology } from "./get-global-mesh-nodes-for-merged-topology"
import { splitCapacityNodeAroundCutouts } from "./split-capacity-node-around-cutouts"

function doNodesShareLayer(
  firstNode: CapacityMeshNode,
  secondNode: CapacityMeshNode,
): boolean {
  return firstNode.availableZ.some((z: number): boolean =>
    secondNode.availableZ.includes(z),
  )
}

function doNodesHaveSameBoundsAndLayers(
  firstNode: CapacityMeshNode,
  secondNode: CapacityMeshNode,
): boolean {
  const firstAvailableZ: number[] = [...firstNode.availableZ].sort(
    (a: number, b: number): number => a - b,
  )
  const secondAvailableZ: number[] = [...secondNode.availableZ].sort(
    (a: number, b: number): number => a - b,
  )

  if (
    firstAvailableZ.length !== secondAvailableZ.length ||
    firstAvailableZ.some(
      (z: number, index: number): boolean => z !== secondAvailableZ[index],
    )
  ) {
    return false
  }

  const firstBounds = getCapacityMeshNodeBounds(firstNode)
  const secondBounds = getCapacityMeshNodeBounds(secondNode)
  return (
    Math.abs(firstBounds.minX - secondBounds.minX) <= GEOMETRY_EPSILON &&
    Math.abs(firstBounds.maxX - secondBounds.maxX) <= GEOMETRY_EPSILON &&
    Math.abs(firstBounds.minY - secondBounds.minY) <= GEOMETRY_EPSILON &&
    Math.abs(firstBounds.maxY - secondBounds.maxY) <= GEOMETRY_EPSILON
  )
}

function assertCompatibleDuplicateObstacleSemantics(
  globalNode: CapacityMeshNode,
  componentNode: CapacityMeshNode,
): void {
  if (
    globalNode._targetConnectionName !== undefined &&
    componentNode._targetConnectionName !== undefined &&
    globalNode._targetConnectionName !== componentNode._targetConnectionName
  ) {
    throw new Error(
      `Cannot merge duplicate obstacle nodes "${globalNode.capacityMeshNodeId}" and "${componentNode.capacityMeshNodeId}" with incompatible target connection names "${globalNode._targetConnectionName}" and "${componentNode._targetConnectionName}"`,
    )
  }
  if (
    globalNode._offBoardConnectionId !== undefined &&
    componentNode._offBoardConnectionId !== undefined &&
    globalNode._offBoardConnectionId !== componentNode._offBoardConnectionId
  ) {
    throw new Error(
      `Cannot merge duplicate obstacle nodes "${globalNode.capacityMeshNodeId}" and "${componentNode.capacityMeshNodeId}" with incompatible off-board connection ids`,
    )
  }
  if (
    globalNode._offboardNetName !== undefined &&
    componentNode._offboardNetName !== undefined &&
    globalNode._offboardNetName !== componentNode._offboardNetName
  ) {
    throw new Error(
      `Cannot merge duplicate obstacle nodes "${globalNode.capacityMeshNodeId}" and "${componentNode.capacityMeshNodeId}" with incompatible off-board net names`,
    )
  }
}

function mergeDuplicateObstacleSemantics(
  componentNode: CapacityMeshNode,
  globalNode: CapacityMeshNode,
): CapacityMeshNode {
  assertCompatibleDuplicateObstacleSemantics(globalNode, componentNode)
  const offBoardConnectedCapacityMeshNodeIds: string[] = [
    ...new Set([
      ...(componentNode._offBoardConnectedCapacityMeshNodeIds ?? []),
      ...(globalNode._offBoardConnectedCapacityMeshNodeIds ?? []),
    ]),
  ]

  return {
    ...componentNode,
    _containsTarget: Boolean(
      componentNode._containsTarget || globalNode._containsTarget,
    ),
    _targetConnectionName:
      componentNode._targetConnectionName ?? globalNode._targetConnectionName,
    _isVirtualOffboard: Boolean(
      componentNode._isVirtualOffboard || globalNode._isVirtualOffboard,
    ),
    _offboardNetName:
      componentNode._offboardNetName ?? globalNode._offboardNetName,
    _offBoardConnectionId:
      componentNode._offBoardConnectionId ?? globalNode._offBoardConnectionId,
    _offBoardConnectedCapacityMeshNodeIds:
      offBoardConnectedCapacityMeshNodeIds.length > 0
        ? offBoardConnectedCapacityMeshNodeIds
        : undefined,
  }
}

function remapOffBoardConnectedNodeIds(
  nodes: CapacityMeshNode[],
  removedNodeIdToRetainedNodeId: ReadonlyMap<string, string>,
): CapacityMeshNode[] {
  if (removedNodeIdToRetainedNodeId.size === 0) return nodes

  return nodes.map((node: CapacityMeshNode): CapacityMeshNode => {
    if (node._offBoardConnectedCapacityMeshNodeIds === undefined) return node

    return {
      ...node,
      _offBoardConnectedCapacityMeshNodeIds: [
        ...new Set(
          node._offBoardConnectedCapacityMeshNodeIds.map(
            (connectedNodeId: string): string =>
              removedNodeIdToRetainedNodeId.get(connectedNodeId) ??
              connectedNodeId,
          ),
        ),
      ],
    }
  })
}

function doNodesHavePositiveAreaOverlap(
  firstNode: CapacityMeshNode,
  secondNode: CapacityMeshNode,
): boolean {
  if (!doNodesShareLayer(firstNode, secondNode)) return false

  return Boolean(
    getBoundsIntersection(
      getCapacityMeshNodeBounds(firstNode),
      getCapacityMeshNodeBounds(secondNode),
    ),
  )
}

function assertNoCrossOriginRoutingOverlaps(
  globalMeshNodes: CapacityMeshNode[],
  componentMeshNodes: CapacityMeshNode[],
): void {
  for (const globalNode of globalMeshNodes) {
    if (globalNode._containsObstacle) continue

    for (const componentNode of componentMeshNodes) {
      if (componentNode._containsObstacle) continue
      if (!doNodesHavePositiveAreaOverlap(globalNode, componentNode)) continue

      throw new Error(
        `Merged topology contains overlapping global and component routing nodes: "${globalNode.capacityMeshNodeId}" and "${componentNode.capacityMeshNodeId}"`,
      )
    }
  }
}

/**
 * Replaces the global component-region node with the finer component-local
 * routing regions, while preserving internal global target/obstacle nodes.
 */
export function mergeMeshNodes({
  globalMeshNodes,
  components,
  componentMeshNodes,
  mergeStrategy,
}: {
  globalMeshNodes: CapacityMeshNode[]
  components: SerializedTopologyComponentInput[]
  componentMeshNodes: CapacityMeshNode[][]
  mergeStrategy: TopologyMeshMergeStrategy
}): CapacityMeshNode[] {
  switch (mergeStrategy) {
    case "concat":
      const globalNodesBeforeDuplicateRemoval =
        getGlobalMeshNodesForMergedTopology({
          meshNodes: globalMeshNodes,
          components,
        })
      const removedGlobalNodeIdToRetainedComponentNodeId = new Map<
        string,
        string
      >()
      const componentMeshNodesWithMergedObstacleSemantics: CapacityMeshNode[][] =
        componentMeshNodes.map(
          (nodes: CapacityMeshNode[]): CapacityMeshNode[] =>
            nodes.map((componentNode: CapacityMeshNode): CapacityMeshNode => {
              if (componentNode._containsObstacle !== true) return componentNode

              const duplicateGlobalNodes =
                globalNodesBeforeDuplicateRemoval.filter(
                  (globalNode: CapacityMeshNode): boolean =>
                    globalNode._containsObstacle === true &&
                    doNodesHaveSameBoundsAndLayers(globalNode, componentNode),
                )
              for (const globalNode of duplicateGlobalNodes) {
                const existingRetainedNodeId =
                  removedGlobalNodeIdToRetainedComponentNodeId.get(
                    globalNode.capacityMeshNodeId,
                  )
                if (
                  existingRetainedNodeId !== undefined &&
                  existingRetainedNodeId !== componentNode.capacityMeshNodeId
                ) {
                  throw new Error(
                    `Global obstacle node "${globalNode.capacityMeshNodeId}" matches multiple component obstacle nodes "${existingRetainedNodeId}" and "${componentNode.capacityMeshNodeId}"`,
                  )
                }
                removedGlobalNodeIdToRetainedComponentNodeId.set(
                  globalNode.capacityMeshNodeId,
                  componentNode.capacityMeshNodeId,
                )
              }

              return duplicateGlobalNodes.reduce(
                (
                  mergedComponentNode: CapacityMeshNode,
                  globalNode: CapacityMeshNode,
                ): CapacityMeshNode =>
                  mergeDuplicateObstacleSemantics(
                    mergedComponentNode,
                    globalNode,
                  ),
                componentNode,
              )
            }),
        )
      const componentObstacleNodes: CapacityMeshNode[] =
        componentMeshNodesWithMergedObstacleSemantics
          .flat()
          .filter(
            (node: CapacityMeshNode): boolean =>
              node._containsObstacle === true,
          )
      const globalNodesForMergedTopology =
        globalNodesBeforeDuplicateRemoval.filter(
          (globalNode: CapacityMeshNode): boolean =>
            !(
              globalNode._containsObstacle === true &&
              componentObstacleNodes.some(
                (componentNode: CapacityMeshNode): boolean =>
                  doNodesHaveSameBoundsAndLayers(globalNode, componentNode),
              )
            ),
        )
      const componentMeshNodesWithCutouts =
        componentMeshNodesWithMergedObstacleSemantics.flatMap(
          (nodes, componentIndex) => {
            const component = components[componentIndex]
            if (!component) {
              throw new Error(
                `Missing topology component for component mesh node group ${componentIndex}`,
              )
            }
            const cutoutNodes: CapacityMeshNode[] =
              globalNodesForMergedTopology.filter((globalNode) =>
                nodes.some((componentNode: CapacityMeshNode): boolean =>
                  doNodesHavePositiveAreaOverlap(globalNode, componentNode),
                ),
              )

            return nodes.flatMap((node: CapacityMeshNode): CapacityMeshNode[] =>
              splitCapacityNodeAroundCutouts({
                node,
                cutoutNodes,
              }),
            )
          },
        )

      assertNoCrossOriginRoutingOverlaps(
        globalNodesForMergedTopology,
        componentMeshNodesWithCutouts,
      )

      return remapOffBoardConnectedNodeIds(
        [...globalNodesForMergedTopology, ...componentMeshNodesWithCutouts],
        removedGlobalNodeIdToRetainedComponentNodeId,
      )
  }
}
