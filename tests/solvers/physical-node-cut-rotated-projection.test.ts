import { expect, test } from "bun:test"
import {
  createFixedCopperNodeCutContext,
  getFixedCopperNodeCuts,
} from "lib/solvers/NodeDimensionSubdivisionSolver/getFixedCopperNodeCuts"
import { createPhysicalNodeCutFixture } from "tests/fixtures/createPhysicalNodeCutFixture"

test("rotated projected bounds only propose cuts and exact finite-cut geometry decides capacity", (): void => {
  const { node, context } = createPhysicalNodeCutFixture()
  const rectangle = {
    ...context.rectangles[0]!,
    center: { x: 1.75, y: 0 },
    ccwRotationDegrees: 45,
  }
  const result = getFixedCopperNodeCuts({
    node,
    context: createFixedCopperNodeCutContext({
      ...context,
      rectangles: [rectangle],
    }),
  })
  // Both extreme-Y cuts are farther than .125 from the rotated rectangle,
  // while its center cut is not. The projected AABB is only a prefilter.
  expect(result.cuts).toHaveLength(1)
  expect(result.nodes).toHaveLength(2)
  expect(result.nodes.map((child): number => child.height)).toEqual([4, 4])
  expect(result.nodes.map((child): number => child.center.y)).toEqual([-2, 2])
  const rotatedNode = { ...node, width: node.height, height: node.width }
  const horizontal = getFixedCopperNodeCuts({
    node: rotatedNode,
    context: createFixedCopperNodeCutContext({
      ...context,
      rectangles: [
        {
          ...context.rectangles[0]!,
          center: { x: 0, y: 1.5 },
          width: 2,
          height: 1,
        },
      ],
    }),
  })
  expect(horizontal.cuts).toHaveLength(3)
  expect(horizontal.nodes.map((child): number => child.width)).toEqual([
    3, 1, 1, 3,
  ])
})
