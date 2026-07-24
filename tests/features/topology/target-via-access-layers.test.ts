import { expect, test } from "bun:test"
import {
  addTargetViaAccessLayers,
  hasViaAccessOverlap,
} from "lib/solvers/NodeDimensionSubdivisionSolver/add-target-via-access-layers"
import type { CapacityMeshNode } from "lib/types"

function createNode(
  capacityMeshNodeId: string,
  availableZ: number[],
  overrides: Partial<CapacityMeshNode>,
): CapacityMeshNode {
  return {
    capacityMeshNodeId,
    center: { x: 0, y: 0 },
    width: 0.4,
    height: 0.4,
    layer: `z${availableZ.join(",")}`,
    availableZ,
    ...overrides,
  }
}

test("promotes physically overlapping target and free regions to via-access layers", () => {
  const nodes = [
    createNode("target-top", [0], {
      _containsTarget: true,
      _containsObstacle: true,
      _connectedTo: ["net-1"],
    }),
    createNode("target-bottom", [1], {
      _containsTarget: true,
      _containsObstacle: true,
      _connectedTo: ["net-1"],
    }),
    createNode("free-top", [0], {}),
    createNode("free-bottom", [1], {}),
  ]

  const stats = addTargetViaAccessLayers({
    nodes,
    layerCount: 2,
    viaDiameter: 0.3,
    componentBounds: [{ minX: -1, maxX: 1, minY: -1, maxY: 1 }],
  })

  expect(stats).toEqual({
    expandedTargetNodeCount: 2,
    freeViaPortalNodeCount: 2,
  })
  expect(nodes.every((node) => node.availableZ.join(",") === "0,1")).toBe(true)
  expect(hasViaAccessOverlap(nodes[0]!, nodes[2]!, 0.3)).toBe(true)
})
