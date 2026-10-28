import { expect, test } from "bun:test"
import {
  createTopologyMergingTestNode,
  solveTopologyMergingTestGroups,
} from "../fixtures/topology-merging-test-utils"

// A via (global target on every layer) drilled into a BGA pad (component
// target on z0). The global target owns z0 inside the pad, but the pad is
// restored to its full bounds over it.
test("repro: topology merging restores a component target over the global target inside it", (): void => {
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

  expect(() =>
    solveTopologyMergingTestGroups([
      { groupId: "global", nodes: [globalVia], isComponent: false },
      { groupId: "component", nodes: [componentPad], isComponent: true },
    ]),
  ).toThrow(
    'output nodes "component-pad" and "global-via" have an unresolved inter-group overlap on a shared layer',
  )
})
