import type { CapacityMeshNodeId, SimpleRouteJson } from "../../types";
import type { PortPoint } from "../../types/high-density-types";
import type {
  ConnectionPathResult,
  InputNodeWithPortPoints,
  InputPortPoint,
} from "./PortPointPathingSolver";
import { getConnectionsWithNodes } from "./getConnectionsWithNodes";

/**
 * Precomputed parameters that can be shared across multiple PortPointPathingSolver instances.
 * These are computed once and passed to each solver to avoid redundant computation.
 */
export interface PrecomputedInitialParams {
  /** Map from nodeId to InputNodeWithPortPoints */
  nodeMap: Map<CapacityMeshNodeId, InputNodeWithPortPoints>;
  /** Average node pitch for heuristic calculations */
  avgNodePitch: number;
  /** Nodes with off-board connections */
  offBoardNodes: InputNodeWithPortPoints[];
  /** Map from portPointId to InputPortPoint */
  portPointMap: Map<string, InputPortPoint>;
  /** Map from nodeId to list of port points accessible from that node */
  nodePortPointsMap: Map<CapacityMeshNodeId, InputPortPoint[]>;
  /** Map from nodeId to assigned port points (empty initially, will be cloned per solver) */
  nodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]>;
  /** Connections with results (NOT shuffled) - shuffling is done per solver */
  unshuffledConnectionsWithResults: ConnectionPathResult[];
  /** Map from connection name to goal node IDs */
  connectionNameToGoalNodeIds: Map<string, CapacityMeshNodeId[]>;
}

/**
 * Precomputes shared parameters that can be reused across multiple PortPointPathingSolver instances.
 * This is useful for HyperPortPointPathingSolver where we create many solver instances with
 * different hyperparameters but the same base data.
 */
export function precomputeSharedParams(
  simpleRouteJson: SimpleRouteJson,
  inputNodes: InputNodeWithPortPoints[],
): PrecomputedInitialParams {
  // Build nodeMap
  const nodeMap = new Map(inputNodes.map((n) => [n.capacityMeshNodeId, n]));

  // Compute average node pitch for heuristic
  const pitches = inputNodes
    .map((n) => (n.width + n.height) / 2)
    .filter((x) => Number.isFinite(x) && x > 0);
  const avgNodePitch =
    pitches.length > 0
      ? pitches.reduce((a, b) => a + b, 0) / pitches.length
      : 1;

  // Cache off-board nodes
  const offBoardNodes = inputNodes.filter((n) => n._offBoardConnectionId);

  // Build port point maps
  const portPointMap = new Map<string, InputPortPoint>();
  const nodePortPointsMap = new Map<CapacityMeshNodeId, InputPortPoint[]>();
  const nodeAssignedPortPoints = new Map<CapacityMeshNodeId, PortPoint[]>();

  for (const node of inputNodes) {
    nodePortPointsMap.set(node.capacityMeshNodeId, []);
    nodeAssignedPortPoints.set(node.capacityMeshNodeId, []);
  }

  for (const node of inputNodes) {
    for (const pp of node.portPoints) {
      portPointMap.set(pp.portPointId, pp);

      // Add to both nodes that share this port point
      for (const nodeId of pp.connectionNodeIds) {
        const nodePortPoints = nodePortPointsMap.get(nodeId);
        if (
          nodePortPoints &&
          !nodePortPoints.some((p) => p.portPointId === pp.portPointId)
        ) {
          nodePortPoints.push(pp);
        }
      }
    }
  }

  // Get connections with nodes (unshuffled)
  const { unshuffledConnectionsWithResults, connectionNameToGoalNodeIds } =
    getConnectionsWithNodes(simpleRouteJson, inputNodes);

  return {
    nodeMap,
    avgNodePitch,
    offBoardNodes,
    portPointMap,
    nodePortPointsMap,
    nodeAssignedPortPoints,
    unshuffledConnectionsWithResults,
    connectionNameToGoalNodeIds,
  };
}

/**
 * Clones the mutable parts of precomputed params for use in a new solver instance.
 * Only nodeAssignedPortPoints needs to be cloned since it's mutated during solving.
 */
export function clonePrecomputedMutableParams(
  params: PrecomputedInitialParams,
): Pick<PrecomputedInitialParams, "nodeAssignedPortPoints"> {
  // Clone nodeAssignedPortPoints - this is mutated during solving
  const nodeAssignedPortPoints = new Map<CapacityMeshNodeId, PortPoint[]>();
  for (const [nodeId, portPoints] of params.nodeAssignedPortPoints) {
    nodeAssignedPortPoints.set(nodeId, [...portPoints]);
  }

  return {
    nodeAssignedPortPoints,
  };
}
