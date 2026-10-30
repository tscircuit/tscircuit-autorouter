import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"

test("free component and global layers remain connected through one routing volume", (): void => {
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
            capacityMeshNodeId: "component-free",
            center: { x: 0, y: 0 },
            width: 4,
            height: 4,
            layer: "z3",
            availableZ: [3],
          },
        ],
      },
    ],
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const volume = solver.getOutput().filter(
    (node): boolean =>
      Math.abs(node.center.x) < node.width / 2 &&
      Math.abs(node.center.y) < node.height / 2,
  )
  expect(volume).toHaveLength(1)
  expect(volume[0]!.availableZ).toEqual([0, 1, 2, 3])
  expect(solver.getOutput()).toHaveLength(1)
  expect(volume[0]!.width).toBe(10)
  expect(volume[0]!.height).toBe(10)
})
