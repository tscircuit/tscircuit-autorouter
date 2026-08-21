import { CapacityMeshNode, CapacityMeshEdge } from "lib/types";

// Node Definitions based on multisectioncapacitypathing3.json section* fields
// Includes nodeA0 from main nodes list as it's referenced in sectionEdges/Terminals

const nodeA0 = {
  capacityMeshNodeId: "nodeA0",
  center: { x: 1, y: 1 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: true,
  _containsObstacle: true,
};
const nodeA = {
  capacityMeshNodeId: "nodeA",
  center: { x: 1, y: 3 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: false, // Updated from JSON sectionNodes
};
const nodeF = {
  capacityMeshNodeId: "nodeF",
  center: { x: 7, y: 1 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: false, // Updated from JSON sectionNodes
};
const nodeC = {
  capacityMeshNodeId: "nodeC",
  center: { x: 5, y: 1 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: true, // From JSON sectionNodes
  _containsObstacle: true, // From JSON sectionNodes
};
const nodeR2C2 = {
  capacityMeshNodeId: "nodeR2C2",
  center: { x: 3, y: 3 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: false, // Updated from JSON sectionNodes
};
const nodeR2C3 = {
  capacityMeshNodeId: "nodeR2C3",
  center: { x: 5, y: 3 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: false, // Updated from JSON sectionNodes
};
const nodeR2C4 = {
  capacityMeshNodeId: "nodeR2C4",
  center: { x: 7, y: 3 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: false, // Updated from JSON sectionNodes
};
const nodeR3C3 = {
  capacityMeshNodeId: "nodeR3C3",
  center: { x: 5, y: 5 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: false, // Updated from JSON sectionNodes
};
const nodeR3C4 = {
  capacityMeshNodeId: "nodeR3C4",
  center: { x: 7, y: 5 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: false, // Updated from JSON sectionNodes
};
const nodeB = {
  capacityMeshNodeId: "nodeB",
  center: { x: 1, y: 7 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: false, // Updated from JSON sectionNodes
};
const nodeR4C2 = {
  capacityMeshNodeId: "nodeR4C2",
  center: { x: 3, y: 7 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: false, // Updated from JSON sectionNodes
};
const nodeR4C3 = {
  capacityMeshNodeId: "nodeR4C3",
  center: { x: 5, y: 7 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: false, // Updated from JSON sectionNodes
};
const nodeD = {
  capacityMeshNodeId: "nodeD",
  center: { x: 5, y: 9 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: false, // Updated from JSON sectionNodes
};
const nodeB1 = {
  capacityMeshNodeId: "nodeB1",
  center: { x: 1, y: 9 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: false, // From JSON sectionNodes
};
const nodeB2 = {
  capacityMeshNodeId: "nodeB2",
  center: { x: 1, y: 11 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: true, // From JSON sectionNodes
  _containsObstacle: true, // From JSON sectionNodes
};
const nodeE = {
  capacityMeshNodeId: "nodeE",
  center: { x: 7, y: 9 },
  width: 1,
  height: 1,
  availableZ: [0, 1],
  layer: "top",
  _containsTarget: false, // Updated from JSON sectionNodes
};

export const sectionNodes: CapacityMeshNode[] = [
  nodeA0, // Added
  nodeA,
  nodeF,
  nodeC,
  nodeR2C2,
  nodeR2C3,
  nodeR2C4,
  nodeR3C3,
  nodeR3C4,
  nodeB,
  nodeR4C2,
  nodeR4C3,
  nodeD,
  nodeB1, // Added
  nodeB2, // Added
  nodeE,
];

// Edge Definitions (from JSON sectionEdges)
export const sectionEdges: CapacityMeshEdge[] = [
  { nodeIds: ["nodeA0", "nodeA"], capacityMeshEdgeId: "edgeA0_A" },
  { nodeIds: ["nodeC", "nodeF"], capacityMeshEdgeId: "edgeC_F" },
  { nodeIds: ["nodeF", "nodeR2C4"], capacityMeshEdgeId: "edgeF_R2C4" },
  { nodeIds: ["nodeC", "nodeR2C3"], capacityMeshEdgeId: "edgeC_R2C3" },
  { nodeIds: ["nodeA", "nodeR2C2"], capacityMeshEdgeId: "edgeA_R2C2" },
  {
    nodeIds: ["nodeR2C2", "nodeR2C3"],
    capacityMeshEdgeId: "edgeR2C2_R2C3",
  },
  {
    nodeIds: ["nodeR2C3", "nodeR2C4"],
    capacityMeshEdgeId: "edgeR2C3_R2C4",
  },
  {
    nodeIds: ["nodeR2C3", "nodeR3C3"],
    capacityMeshEdgeId: "edgeR2C3_R3C3",
  },
  {
    nodeIds: ["nodeR2C4", "nodeR3C4"],
    capacityMeshEdgeId: "edgeR2C4_R3C4",
  },
  {
    nodeIds: ["nodeR3C3", "nodeR3C4"],
    capacityMeshEdgeId: "edgeR3C3_R3C4",
  },
  {
    nodeIds: ["nodeR3C3", "nodeR4C3"],
    capacityMeshEdgeId: "edgeR3C3_R4C3",
  },
  { nodeIds: ["nodeB", "nodeR4C2"], capacityMeshEdgeId: "edgeB_R4C2" },
  {
    nodeIds: ["nodeR4C2", "nodeR4C3"],
    capacityMeshEdgeId: "edgeR4C2_R4C3",
  },
  { nodeIds: ["nodeR4C3", "nodeD"], capacityMeshEdgeId: "edgeR4C3_D" },
  { nodeIds: ["nodeD", "nodeE"], capacityMeshEdgeId: "edgeD_E" },
  { nodeIds: ["nodeB", "nodeB1"], capacityMeshEdgeId: "edgeB_B1" },
  { nodeIds: ["nodeB1", "nodeB2"], capacityMeshEdgeId: "edgeB1_B2" },
];

// Connection Terminals (from JSON sectionConnectionTerminals)
export const sectionConnectionTerminals: Array<{
  connectionName: string;
  startNodeId: string;
  endNodeId: string;
}> = [
  {
    connectionName: "connection_A_B",
    startNodeId: "nodeA0", // Updated from JSON
    endNodeId: "nodeB2", // Updated from JSON
  },
  {
    connectionName: "connection_C_D",
    startNodeId: "nodeC", // Updated from JSON
    endNodeId: "nodeD", // Updated from JSON
  },
];

// Create node map
export const nodeMap = new Map(
  sectionNodes.map((node) => [node.capacityMeshNodeId, node]),
);

// Create node edge map
export const nodeEdgeMap = new Map<string, CapacityMeshEdge[]>();
for (const node of sectionNodes) {
  const edges = sectionEdges.filter((edge) =>
    edge.nodeIds.includes(node.capacityMeshNodeId),
  );
  nodeEdgeMap.set(node.capacityMeshNodeId, edges);
}
