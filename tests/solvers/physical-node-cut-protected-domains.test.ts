import { expect, test } from "bun:test"
import {
  createFixedCopperNodeCutContext,
  getFixedCopperNodeCuts,
} from "lib/solvers/NodeDimensionSubdivisionSolver/getFixedCopperNodeCuts"
import type { CapacityMeshNode } from "lib/types"
import { createPhysicalNodeCutFixture } from "tests/fixtures/createPhysicalNodeCutFixture"

test("physical cuts preserve source-anchor tolerance and special node ownership domains", (): void => {
  const { node, context } = createPhysicalNodeCutFixture()
  const excluded: Partial<CapacityMeshNode>[] = [
    { _isComponentTopologyNode: true },
    { _containsObstacle: true },
    { _completelyInsideObstacle: true },
    { _containsTarget: true },
    { _targetConnectionName: "route-a" },
    { _strawNode: true },
    { _strawParentCapacityMeshNodeId: "straw-parent" },
    { _isVirtualOffboard: true },
    { _offboardNetName: "route-a" },
    { _offBoardConnectionId: "offboard-a" },
    { _offBoardConnectedCapacityMeshNodeIds: ["neighbor"] },
    { _qfpRegionType: "pad-gap" },
    { _isNarrowQfpPadGap: true },
    { _soicRegionType: "pad-gap" },
    { _connectedTo: ["route-a"] },
    { _adjacentNodeIds: ["neighbor"] },
    { _parent: node },
  ]
  const prepared = createFixedCopperNodeCutContext(context)
  for (const metadata of excluded) {
    const protectedNode = { ...node, ...metadata }
    const result = getFixedCopperNodeCuts({
      node: protectedNode,
      context: prepared,
    })
    expect(result.cuts).toEqual([])
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]).toBe(protectedNode)
  }
  for (const point of [
    { x: 0, y: 0 },
    { x: 1.0005, y: 0 },
    { x: 1.001, y: 4.001 },
  ]) {
    const result = getFixedCopperNodeCuts({
      node,
      context: createFixedCopperNodeCutContext({
        ...context,
        protectedPoints: [point],
      }),
    })
    expect(result.cuts).toEqual([])
    expect(result.nodes[0]).toBe(node)
  }
  expect(getFixedCopperNodeCuts({ node, context: prepared }).cuts).toHaveLength(3)
})
