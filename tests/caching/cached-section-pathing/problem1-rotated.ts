import { CapacityMeshNode, CapacityMeshEdge } from "lib/types";
import * as originalProblem from "./problem1";

// Function to rotate a point 90 degrees clockwise around the origin
const rotatePoint = (point: { x: number; y: number }) => {
  return { x: point.y, y: -point.x };
};

// Rotate nodes
export const sectionNodes: CapacityMeshNode[] =
  originalProblem.sectionNodes.map((node) => ({
    ...node,
    center: rotatePoint(node.center),
  }));

// Edges remain the same in terms of node IDs
export const sectionEdges: CapacityMeshEdge[] = originalProblem.sectionEdges;

// Connection terminals remain the same in terms of node IDs
export const sectionConnectionTerminals: Array<{
  connectionName: string;
  startNodeId: string;
  endNodeId: string;
}> = originalProblem.sectionConnectionTerminals;

// Create node map for rotated nodes
export const nodeMap = new Map(
  sectionNodes.map((node) => [node.capacityMeshNodeId, node]),
);

// Create node edge map using original edges but referencing the rotated node map
export const nodeEdgeMap = new Map<string, CapacityMeshEdge[]>();
for (const node of sectionNodes) {
  const edges = sectionEdges.filter((edge) =>
    edge.nodeIds.includes(node.capacityMeshNodeId),
  );
  nodeEdgeMap.set(node.capacityMeshNodeId, edges);
}
