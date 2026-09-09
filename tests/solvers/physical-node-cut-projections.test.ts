import { expect, test } from "bun:test"
import {
  createFixedCopperNodeCutContext,
  getFixedCopperNodeCuts,
} from "lib/solvers/NodeDimensionSubdivisionSolver/getFixedCopperNodeCuts"
import { getFixedCopperPortalSites } from "lib/solvers/UniformPortDistributionSolver/getFixedCopperPortalSites"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import { createPhysicalNodeCutFixture } from "tests/fixtures/createPhysicalNodeCutFixture"

test("physical node cuts retain min center max projections and actual adjacent child pairs", (): void => {
  const { node, context } = createPhysicalNodeCutFixture()
  const before = structuredClone({ node, context })
  const result = getFixedCopperNodeCuts({
    node,
    context: createFixedCopperNodeCutContext(context),
  })
  expect(result.nodes).toHaveLength(4)
  expect(result.cuts).toHaveLength(3)
  expect(result.nodes.map((child): number => child.height)).toEqual([
    3, 1, 1, 3,
  ])
  expect(result.nodes.map((child): number => child.center.y)).toEqual([
    -2.5, -0.5, 0.5, 2.5,
  ])
  for (const [index, cut] of result.cuts.entries()) {
    const lower = result.nodes[index]!
    const upper = result.nodes[index + 1]!
    expect(cut.nodeIds).toEqual([
      lower.capacityMeshNodeId,
      upper.capacityMeshNodeId,
    ])
    expect(areNodesBordering(lower, upper)).toBe(true)
    const y = lower.center.y + lower.height / 2
    expect(y).toBe([-1, 0, 1][index]!)
    const sites = getFixedCopperPortalSites({
      ...context,
      start: { x: -1, y },
      end: { x: 1, y },
      zLayers: [0, 1],
    })
    expect(sites.layers.map((layer): number => layer.capacity)).toEqual([9, 8])
    expect(sites.totalCapacity).toBe(17)
  }
  expect(
    new Set(result.cuts.map((cut): string => cut.physicalCutId)).size,
  ).toBe(3)
  expect(result.nodes[0]!.center.y - result.nodes[0]!.height / 2).toBe(-4)
  expect(result.nodes[3]!.center.y + result.nodes[3]!.height / 2).toBe(4)
  expect({ node, context }).toEqual(before)
})
