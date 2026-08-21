import { CapacityMeshNode, CapacityMeshEdge } from "lib/types";
import * as originalProblem from "./problem1";

// Use the same nodes and edges as the original problem
export const sectionNodes: CapacityMeshNode[] = originalProblem.sectionNodes;
export const sectionEdges: CapacityMeshEdge[] = originalProblem.sectionEdges;

// Flip the start and end nodes for connection_A_B
export const sectionConnectionTerminals: Array<{
  connectionName: string;
  startNodeId: string;
  endNodeId: string;
}> = [
  {
    connectionName: "connection_A_B",
    startNodeId: originalProblem.sectionConnectionTerminals[0].endNodeId, // Was nodeA0, now nodeB2
    endNodeId: originalProblem.sectionConnectionTerminals[0].startNodeId, // Was nodeB2, now nodeA0
  },
  originalProblem.sectionConnectionTerminals[1], // Keep connection_C_D the same
];

// Create node map (same as original)
export const nodeMap = new Map(
  sectionNodes.map((node) => [node.capacityMeshNodeId, node]),
);

// Create node edge map (same as original)
export const nodeEdgeMap = new Map<string, CapacityMeshEdge[]>();
for (const node of sectionNodes) {
  const edges = sectionEdges.filter((edge) =>
    edge.nodeIds.includes(node.capacityMeshNodeId),
  );
  nodeEdgeMap.set(node.capacityMeshNodeId, edges);
}
