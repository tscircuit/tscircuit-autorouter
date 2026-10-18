import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import type { TopologyMergingRegion } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import {
  createTopologyMergingTestNode,
  getAvailableZAtPoint,
} from "../../../fixtures/topology-merging-test-utils"

test("atomic cells share matching metadata without merging their layers or geometry", (): void => {
  const solver = new TopologyMergingSolver({
    layerCount: 4,
    nodeGroups: [
      {
        groupId: "global",
        isComponent: false,
        nodes: [
          createTopologyMergingTestNode({
            id: "global",
            bounds: { minX: 0, maxX: 6, minY: 0, maxY: 6 },
            availableZ: [0, 1, 2, 3],
          }),
        ],
      },
      {
        groupId: "component",
        isComponent: true,
        nodes: [
          createTopologyMergingTestNode({
            id: "single-layer",
            bounds: { minX: 1, maxX: 2, minY: 1, maxY: 2 },
            availableZ: [0],
          }),
          createTopologyMergingTestNode({
            id: "other-layer",
            bounds: { minX: 3, maxX: 4, minY: 3, maxY: 4 },
            availableZ: [1],
          }),
        ],
      },
    ],
  })
  while (solver.stats.processedXSlabCount < solver.stats.xSlabCount) {
    solver.step()
  }
  const cells = Reflect.get(solver, "atomicRegions") as TopologyMergingRegion[]
  let sharedCellCount = 0
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]!
    const previous = cells.slice(0, index).find(
      (candidate) =>
        candidate.topologySignature === cell.topologySignature &&
        JSON.stringify(candidate.availableZ) === JSON.stringify(cell.availableZ),
    )
    if (!previous) continue
    expect(cell.availableZ).toBe(previous.availableZ)
    expect(cell.sourceKeys).toBe(previous.sourceKeys)
    sharedCellCount += 1
  }
  expect(sharedCellCount).toBeGreaterThan(0)
  const firstCell = cells[0]!
  const firstCellBeforeCompaction = structuredClone(firstCell)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(firstCell).toEqual(firstCellBeforeCompaction)
  expect(cells).toEqual([])
  const metadataCache: unknown = Reflect.get(solver, "layerTopologiesByKey")
  if (!(metadataCache instanceof Map)) {
    throw new Error("Topology metadata cache is missing")
  }
  expect(metadataCache.size).toBe(0)
  const nodes = solver.getOutput()
  expect(getAvailableZAtPoint(nodes, { x: 1.5, y: 1.5 })).toEqual([
    [0],
    [1, 2, 3],
  ])
  expect(getAvailableZAtPoint(nodes, { x: 3.5, y: 3.5 })).toEqual([
    [0, 2, 3],
    [1],
  ])
})
