import { expect, test } from "bun:test"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import { createPhysicalNodeCutFixture } from "tests/fixtures/createPhysicalNodeCutFixture"

test("physical cut admission respects the existing aspect-ratio limit without regridding resources", (): void => {
  const { node, context } = createPhysicalNodeCutFixture()
  const regularNode = { ...node, height: 4 }
  const solver = new NodeDimensionSubdivisionSolver(
    [regularNode],
    100,
    2,
    0.01,
    {
      ...context,
      rectangles: [{ ...context.rectangles[0]!, height: 0.25 }],
    },
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.outputPhysicalCuts).toHaveLength(1)
  expect(solver.outputNodes).toHaveLength(2)
  // Sorted source projections are -.125, 0, .125. After the first cut, the
  // latter two would produce width/height > 2 and are not admitted as cuts.
  expect(solver.outputNodes.map((child): number => child.height)).toEqual([
    1.875, 2.125,
  ])
  for (const child of solver.outputNodes) {
    const ratio =
      Math.max(child.width, child.height) / Math.min(child.width, child.height)
    expect(ratio).toBeLessThanOrEqual(2)
  }
  expect(solver.outputPhysicalCuts[0]!.nodeIds).toEqual(
    solver.outputNodes.map((child): string => child.capacityMeshNodeId),
  )
})
