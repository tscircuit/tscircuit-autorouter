import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"

test("free-volume merging preserves pad ownership and blocked layers", (): void => {
  const solver = new TopologyMergingSolver({
    layerCount: 4,
    mergeFreeLayerVolumes: true,
    nodeGroups: [
      {
        groupId: "global",
        isComponent: false,
        nodes: [
          {
            capacityMeshNodeId: "global-free",
            center: { x: 0, y: 0 },
            width: 10,
            height: 10,
            layer: "z0,1,2,3",
            availableZ: [0, 1, 2, 3],
          },
        ],
      },
      {
        groupId: "component",
        isComponent: true,
        nodes: [
          {
            capacityMeshNodeId: "pad",
            center: { x: 0, y: 0 },
            width: 2,
            height: 2,
            layer: "z0",
            availableZ: [0],
            _containsObstacle: true,
            _containsTarget: true,
            _targetConnectionName: "pad-net",
            _connectedTo: ["pad-net"],
          },
        ],
      },
    ],
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const containing = solver.getOutput().filter(
    (node): boolean =>
      Math.abs(node.center.x) < node.width / 2 &&
      Math.abs(node.center.y) < node.height / 2,
  )
  expect(containing).toHaveLength(2)
  const pad = containing.find((node) => node._containsObstacle)!
  expect(pad.availableZ).toEqual([0])
  expect(pad._connectedTo).toEqual(["pad-net"])
  const free = containing.find((node) => !node._containsObstacle)!
  expect(free.availableZ).toEqual([1, 2, 3])
})
