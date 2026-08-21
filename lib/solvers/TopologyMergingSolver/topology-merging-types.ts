import type { Bounds } from "@tscircuit/math-utils";
import type { CapacityMeshNode } from "lib/types";

export const TOPOLOGY_MERGING_EPSILON = 1e-5;
export const TOPOLOGY_PROVENANCE_EPSILON = TOPOLOGY_MERGING_EPSILON * 4;

export interface TopologyMergingNodeGroup {
  groupId: string;
  nodes: CapacityMeshNode[];
  isComponent: boolean;
}

export interface TopologyMergingSolverParams {
  nodeGroups: readonly TopologyMergingNodeGroup[];
  layerCount: number;
}

export type PreparedTopologyMergingNode = {
  sourceKey: string;
  groupIndex: number;
  node: CapacityMeshNode;
  bounds: Bounds;
};

export type TopologyMergingMode =
  "passthrough" | "merged" | "target-passthrough" | "target-merged";

export type TopologyMergingRegion = {
  bounds: Bounds;
  availableZ: number[];
  sourceKeys: string[];
  topologyMode: TopologyMergingMode;
  topologySignature: string;
};

export type TopologyMergingLayerTopology = {
  availableZ: number[];
  sourceKeys: string[];
  topologyMode: TopologyMergingMode;
  topologySignature: string;
};

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
>;
