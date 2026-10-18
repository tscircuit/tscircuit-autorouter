import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import {
  createTopologyMergingTestNode,
  getAvailableZAtPoint,
} from "../../../fixtures/topology-merging-test-utils"

test("completed topology releases slab regions while preserving output and counts", (): void => {
  const allLayers = [0, 1, 2, 3]
  const solver = new TopologyMergingSolver({
    layerCount: 4,
    nodeGroups: [
      {
        groupId: "topology-a",
        isComponent: true,
        nodes: [
          createTopologyMergingTestNode({
            id: "a",
            bounds: { minX: 0, maxX: 2, minY: 1, maxY: 4 },
            availableZ: allLayers,
          }),
        ],
      },
      {
        groupId: "topology-b",
        isComponent: true,
        nodes: [
          createTopologyMergingTestNode({
            id: "b",
            bounds: { minX: 1, maxX: 4, minY: 0, maxY: 3 },
            availableZ: allLayers,
          }),
        ],
      },
    ],
  })
  const atomicRegions: unknown = Reflect.get(solver, "atomicRegions")
  expect(Array.isArray(atomicRegions)).toBe(true)
  solver.step()
  expect(atomicRegions).not.toEqual([])
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(atomicRegions).toEqual([])
  expect(solver.stats.atomicRegionCount).toBeGreaterThan(0)
  expect(solver.stats.compactedRegionCount).toBe(5)
  expect(solver.stats.outputNodeCount).toBe(5)
  const nodes = solver.getOutput()
  expect(nodes).toHaveLength(5)
  expect(getAvailableZAtPoint(nodes, { x: 1.5, y: 2 })).toEqual([allLayers])
  expect(getAvailableZAtPoint(nodes, { x: 0.5, y: 2 })).toEqual([allLayers])
  expect(getAvailableZAtPoint(nodes, { x: 3, y: 2 })).toEqual([allLayers])
})
