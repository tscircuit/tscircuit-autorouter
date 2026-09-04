import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"

test("nearby component boundary rounding does not fragment a free multilayer region", (): void => {
  const solver = new TopologyMergingSolver({
    layerCount: 2,
    nodeGroups: [
      {
        groupId: "global",
        isComponent: false,
        nodes: [
          {
            capacityMeshNodeId: "free-region",
            center: { x: 2, y: 1 },
            width: 4,
            height: 2,
            layer: "z0,1",
            availableZ: [0, 1],
          },
        ],
      },
      {
        groupId: "component",
        isComponent: true,
        nodes: [
          {
            capacityMeshNodeId: "component-region",
            center: { x: 1.5, y: 2.5 - 0.0000002 },
            width: 1,
            height: 1.0000004,
            layer: "z0,1",
            availableZ: [0, 1],
          },
        ],
      },
    ],
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const nodes = solver.getOutput()
  expect(nodes).toHaveLength(2)
  const freeRegion = nodes.find(
    (node) => node.capacityMeshNodeId === "free-region",
  )
  expect(freeRegion).toBeDefined()
  expect(freeRegion!.width).toBe(4)
  expect(freeRegion!.height).toBeCloseTo(2, 5)
  expect(freeRegion!.availableZ).toEqual([0, 1])
})
