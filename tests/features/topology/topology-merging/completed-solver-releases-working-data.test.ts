import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { createTopologyMergingTestNode } from "tests/fixtures/topology-merging-test-utils"

test("completed topology solvers release working data and retain output", (): void => {
  const source = createTopologyMergingTestNode({
    id: "global-space",
    bounds: { minX: 0, maxX: 4, minY: 0, maxY: 2 },
    availableZ: [0, 1],
  })
  const groups = [
    { groupId: "global", isComponent: false, nodes: [source] },
    {
      groupId: "component",
      isComponent: true,
      nodes: [{ ...source, capacityMeshNodeId: "component-space" }],
    },
  ]

  for (const nodeGroups of [groups, groups.slice(0, 1)]) {
    const input = { layerCount: 2, nodeGroups }
    const originalInput = structuredClone(input)
    const solver = new TopologyMergingSolver(input)
    expect(solver["preparedNodes"]).toHaveLength(nodeGroups.length)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.getOutput()).toHaveLength(1)
    expect(solver.getOutput()[0]).toMatchObject({
      center: { x: 2, y: 1 },
      width: 4,
      height: 2,
      availableZ: [0, 1],
    })
    expect(solver.getConstructorParams()).toEqual([originalInput])
    expect(solver["preparedNodes"]).toHaveLength(0)
    expect(solver["preparedNodeBySourceKey"].size).toBe(0)
    expect(solver["xCoordinates"]).toHaveLength(0)
    expect(solver["atomicRegions"]).toHaveLength(0)
    expect(solver["horizontalRegionByBucket"].size).toBe(0)
    expect(solver["overruledTargetSourceKeys"].size).toBe(0)
    expect(solver["outputProvenance"].groupIndexesByNodeId.size).toBe(0)
    expect(solver["outputProvenance"].sourceKeysByNodeId.size).toBe(0)

    const output = structuredClone(solver.getOutput())
    const stats = structuredClone(solver.stats)
    const visualization = solver.visualize()
    expect(visualization.rects).toHaveLength(1)
    expect(visualization.rects![0]).toMatchObject({
      center: { x: 2, y: 1 },
      label: expect.stringContaining("availableZ: 0,1"),
    })
    solver.step()
    expect(solver.getOutput()).toEqual(output)
    expect(solver.visualize()).toEqual(visualization)
    expect(solver.stats).toEqual(stats)
    expect(solver.computeProgress()).toBe(1)
    expect(input).toEqual(originalInput)
  }
})
