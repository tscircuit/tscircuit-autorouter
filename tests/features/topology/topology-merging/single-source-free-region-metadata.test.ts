import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { createTopologyMergingTestNode } from "tests/fixtures/topology-merging-test-utils"

test("clears inherited component flags only in free regions", (): void => {
  for (const allowBlindAndBuriedVias of [true, false]) {
    const sourceNode = {
      ...createTopologyMergingTestNode({
        id: "component-space",
        bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
        availableZ: [0, 1, 2, 3],
      }),
      _isComponentTopologyNode: true,
      _isNarrowQfpPadGap: true,
    }
    const original = structuredClone(sourceNode)
    const solver = new TopologyMergingSolver({
      layerCount: 4,
      allowBlindAndBuriedVias,
      nodeGroups: [
        {
          groupId: "global",
          isComponent: false,
          nodes: [
            createTopologyMergingTestNode({
              id: "global-space",
              bounds: { minX: 3, maxX: 5, minY: -1, maxY: 1 },
              availableZ: [0, 1, 2, 3],
            }),
          ],
        },
        { groupId: "component", isComponent: true, nodes: [sourceNode] },
      ],
    })
    solver.solve()
    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    expect(solver.getOutput()).toHaveLength(2)
    const output = solver.getOutput()[0]!
    expect(output).toMatchObject({
      capacityMeshNodeId: sourceNode.capacityMeshNodeId,
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1, 2, 3],
    })
    if (allowBlindAndBuriedVias) {
      expect(output._isComponentTopologyNode).toBeUndefined()
      expect(output._isNarrowQfpPadGap).toBeUndefined()
    } else {
      expect(output._isComponentTopologyNode).toBeTrue()
      expect(output._isNarrowQfpPadGap).toBeTrue()
    }
    expect(sourceNode).toEqual(original)
  }
})
