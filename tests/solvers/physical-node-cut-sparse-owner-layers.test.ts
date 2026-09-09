import { expect, test } from "bun:test"
import type { FixedCopperRectangle } from "lib/data-structures/FixedCopperClearanceIndex"
import {
  createFixedCopperNodeCutContext,
  getFixedCopperNodeCuts,
} from "lib/solvers/NodeDimensionSubdivisionSolver/getFixedCopperNodeCuts"
import { createPhysicalNodeCutFixture } from "tests/fixtures/createPhysicalNodeCutFixture"

test("only universally foreign layer-relevant capacity reductions produce physical cuts", (): void => {
  const { node, context } = createPhysicalNodeCutFixture()
  const rectangle = context.rectangles[0]!
  const ignoredRectangles: FixedCopperRectangle[][] = [
    [],
    [{ ...rectangle, ownerNetIds: new Set(["route-a"]) }],
    [{ ...rectangle, ownerNetIds: new Set(["foreign-pad", "route-b"]) }],
    [{ ...rectangle, center: { x: 100, y: 0 } }],
    // The clearance envelope touches x=1 exactly, so all old sites remain legal.
    [{ ...rectangle, center: { x: 1.625, y: 0 } }],
  ]
  for (const rectangles of ignoredRectangles) {
    const result = getFixedCopperNodeCuts({
      node,
      context: createFixedCopperNodeCutContext({ ...context, rectangles }),
    })
    expect(result.cuts).toEqual([])
    expect(result.nodes[0]).toBe(node)
  }
  const topOnly = { ...node, availableZ: [0] }
  expect(
    getFixedCopperNodeCuts({
      node: topOnly,
      context: createFixedCopperNodeCutContext(context),
    }).cuts,
  ).toEqual([])
  const blocked = getFixedCopperNodeCuts({
    node,
    context: createFixedCopperNodeCutContext({
      ...context,
      rectangles: [
        { ...rectangle, center: { x: 0, y: 0 }, width: 4, zLayers: [0, 1] },
      ],
    }),
  })
  // Zero-capacity cuts are real constraints, not a reason to omit subdivision.
  expect(blocked.cuts).toHaveLength(3)
})
