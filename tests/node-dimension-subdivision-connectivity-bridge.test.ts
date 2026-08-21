import { expect, test } from "bun:test";
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver";
import type { CapacityMeshNode } from "lib/types";

const createNode = (
  overrides: Partial<CapacityMeshNode> = {},
): CapacityMeshNode => ({
  capacityMeshNodeId: "cmn_0",
  center: { x: 0, y: 0 },
  width: 0.4,
  height: 0.2,
  layer: "top",
  availableZ: [0],
  ...overrides,
});

test("preserves connectivity bridges but removes coordinate slivers", () => {
  const createBridgeNodes = (
    bridgeId: string,
    bridgeHeight: number,
  ): CapacityMeshNode[] => [
    createNode({
      capacityMeshNodeId: `${bridgeId}-top`,
      center: { x: 0, y: -(0.1 + bridgeHeight / 2) },
    }),
    createNode({
      capacityMeshNodeId: bridgeId,
      width: 0.2,
      height: bridgeHeight,
    }),
    createNode({
      capacityMeshNodeId: `${bridgeId}-bottom`,
      center: { x: 0, y: 0.1 + bridgeHeight / 2 },
    }),
  ];
  const solver = new NodeDimensionSubdivisionSolver(
    [
      ...createBridgeNodes("thin-bridge", 0.04),
      ...createBridgeNodes("numeric-sliver", 0.0014).map((node) => ({
        ...node,
        center: { x: node.center.x + 1, y: node.center.y },
      })),
    ],
    100,
    2,
  );

  solver.solve();

  expect(
    solver.outputNodes.some(
      (node) =>
        node.capacityMeshNodeId === "thin-bridge" ||
        node.capacityMeshNodeId.startsWith("thin-bridge__sub_"),
    ),
  ).toBe(true);
  expect(
    solver.outputNodes.some(
      (node) =>
        node.capacityMeshNodeId === "numeric-sliver" ||
        node.capacityMeshNodeId.startsWith("numeric-sliver__sub_"),
    ),
  ).toBe(false);
  expect(solver.stats.removedSmallNodeCount).toBe(1);
});
