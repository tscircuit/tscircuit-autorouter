import { expect, test } from "bun:test"
import {
  createTopologyMergingTestNode,
  solveTopologyMergingTestGroups,
} from "../../../fixtures/topology-merging-test-utils"

// A via (global target on every layer) drilled into a BGA pad (component
// target on z0): the global target owns z0 inside the pad, so the pad must
// not be restored over it.
test("topology merging keeps a component target off the global target inside it", (): void => {
  const targetFields = {
    _containsObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "target-connection",
  }
  const globalVia = {
    ...createTopologyMergingTestNode({
      id: "global-via",
      bounds: { minX: 1, maxX: 2, minY: 1, maxY: 2 },
      availableZ: [0, 1],
    }),
    ...targetFields,
  }
  const componentPad = {
    ...createTopologyMergingTestNode({
      id: "component-pad",
      bounds: { minX: 0, maxX: 3, minY: 0, maxY: 3 },
      availableZ: [0],
    }),
    ...targetFields,
  }
  const output = solveTopologyMergingTestGroups([
    { groupId: "global", nodes: [globalVia], isComponent: false },
    { groupId: "component", nodes: [componentPad], isComponent: true },
  ])

  expect(
    output.find((node) => node.capacityMeshNodeId === "global-via"),
  ).toMatchObject({ center: { x: 1.5, y: 1.5 }, availableZ: [0, 1] })

  const padArea = output
    .filter((node) => node._isComponentTopologyNode)
    .reduce((area, node) => area + node.width * node.height, 0)
  expect(padArea).toBeCloseTo(9 - 1)
})
