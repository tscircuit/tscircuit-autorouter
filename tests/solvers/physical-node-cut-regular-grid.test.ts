import { expect, test } from "bun:test"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import { createPhysicalNodeCutFixture } from "tests/fixtures/createPhysicalNodeCutFixture"

test("physical subdivision follows the unchanged regular grid and keeps no-context behavior", (): void => {
  const { node, context } = createPhysicalNodeCutFixture()
  const legacy = new NodeDimensionSubdivisionSolver([node], 4)
  const physical = new NodeDimensionSubdivisionSolver(
    [node],
    4,
    Number.POSITIVE_INFINITY,
    0.01,
    context,
  )
  legacy.solve()
  physical.solve()
  expect(legacy.solved).toBe(true)
  expect(legacy.outputNodes).toHaveLength(2)
  expect(legacy.outputPhysicalCuts).toEqual([])
  expect(physical.solved).toBe(true)
  expect(physical.outputNodes).toHaveLength(4)
  expect(
    physical.outputPhysicalCuts.map((cut): readonly string[] => cut.nodeIds),
  ).toEqual([
    [
      "ordinary-node__sub_0_0__physical_y_0",
      "ordinary-node__sub_0_0__physical_y_1",
    ],
    [
      "ordinary-node__sub_1_0__physical_y_0",
      "ordinary-node__sub_1_0__physical_y_1",
    ],
  ])
  expect(physical.stats.subdividedNodeCount).toBe(1)
  expect(physical.stats.physicalCutCount).toBe(2)
  expect(
    physical.outputNodes.reduce(
      (area, child): number => area + child.width * child.height,
      0,
    ),
  ).toBe(16)
  expect(legacy.outputNodes.map((child): number => child.center.y)).toEqual([
    -2, 2,
  ])
  expect(legacy.stats).not.toHaveProperty("physicalCutCount")
  expect(node.center).toEqual({ x: 0, y: 0 })
  expect(node.width).toBe(2)
  expect(node.height).toBe(8)
})
