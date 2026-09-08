import { expect, test } from "bun:test"
import {
  createFixedCopperNodeCutContext,
  getFixedCopperNodeCuts,
} from "lib/solvers/NodeDimensionSubdivisionSolver/getFixedCopperNodeCuts"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import { createPhysicalNodeCutFixture } from "tests/fixtures/createPhysicalNodeCutFixture"

test("physical projection admission preserves connectivity dimensions and deterministic source order", (): void => {
  const { node, context } = createPhysicalNodeCutFixture()
  const rectangle = context.rectangles[0]!
  const rectangles = [rectangle, { ...rectangle, center: { x: 1.5, y: 0.001 } }]
  const forward = getFixedCopperNodeCuts({
    node,
    context: createFixedCopperNodeCutContext({ ...context, rectangles }),
  })
  const reverse = getFixedCopperNodeCuts({
    node,
    context: createFixedCopperNodeCutContext({
      ...context,
      rectangles: [...rectangles].reverse(),
    }),
  })
  expect(forward).toEqual(reverse)
  expect(forward.cuts).toHaveLength(3)
  for (const child of forward.nodes) {
    expect(Math.min(child.width, child.height)).toBeGreaterThanOrEqual(0.002)
  }
  for (let index = 0; index < forward.nodes.length - 1; index++) {
    expect(
      areNodesBordering(forward.nodes[index]!, forward.nodes[index + 1]!),
    ).toBe(true)
    if (index + 2 < forward.nodes.length) {
      expect(
        areNodesBordering(forward.nodes[index]!, forward.nodes[index + 2]!),
      ).toBe(false)
    }
  }
  const sliver = getFixedCopperNodeCuts({
    node,
    context: createFixedCopperNodeCutContext({
      ...context,
      rectangles: [
        { ...rectangle, center: { x: 1.5, y: -3.999 }, height: 0.001 },
      ],
    }),
  })
  expect(sliver.cuts).toEqual([])
  expect(sliver.nodes[0]).toBe(node)
})
