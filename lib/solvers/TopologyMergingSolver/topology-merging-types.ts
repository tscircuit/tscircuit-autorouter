import type { Bounds } from "@tscircuit/math-utils"
import type { CapacityMeshNode } from "lib/types"

export const TOPOLOGY_MERGING_EPSILON = 1e-5
export const TOPOLOGY_PROVENANCE_EPSILON = TOPOLOGY_MERGING_EPSILON * 4

export type TopologyMergingSourceKey = string

export interface TopologyMergingNodeGroup {
  groupId: string
  nodes: CapacityMeshNode[]
  isComponent: boolean
}

export interface TopologyMergingSolverParams {
  nodeGroups: readonly TopologyMergingNodeGroup[]
  layerCount: number
  minViaPadDiameter?: number
}

export type PreparedTopologyMergingNode = {
  sourceKey: TopologyMergingSourceKey
  groupIndex: number
  node: CapacityMeshNode
  bounds: Bounds
}

export type TopologyMergingMode =
  | "free_layer_union"
  | "passthrough"
  | "merged"
  | "target-passthrough"
  | "target-merged"

export type TopologyMergingRegion = {
  bounds: Bounds
  availableZ: number[]
  sourceKeys: TopologyMergingSourceKey[]
  topologyMode: TopologyMergingMode
  topologySignature: string
}

export type TopologyMergingLayerTopology = {
  availableZ: number[]
  sourceKeys: TopologyMergingSourceKey[]
  topologyMode: TopologyMergingMode
  topologySignature: string
}

export type TopologyMergingRegionMetadata = Pick<
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
  | "_connectedTo"
>
