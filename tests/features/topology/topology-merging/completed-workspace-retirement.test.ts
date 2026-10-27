import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import type { TopologyMergingOutputProvenance } from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import type {
  PreparedTopologyMergingNode,
  TopologyMergingRegion,
  TopologyMergingSolverParams,
} from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import { createTopologyMergingTestNode } from "../../../fixtures/topology-merging-test-utils"

type TopologyMergingWorkspace = {
  preparedNodes: PreparedTopologyMergingNode[]
  preparedNodeBySourceKey: Map<string, PreparedTopologyMergingNode>
  xCoordinates: number[]
  atomicRegions: TopologyMergingRegion[]
  outputProvenance: TopologyMergingOutputProvenance
  releaseConstructionWorkspace(): void
}

test("completed topology merging retires its workspace while preserving outputs and graphics", (): void => {
  const nodeGroups: TopologyMergingSolverParams["nodeGroups"] = [
    {
      groupId: "topology-a",
      isComponent: true,
      nodes: [
        createTopologyMergingTestNode({
          id: "a",
          bounds: { minX: 0, maxX: 2, minY: 1, maxY: 4 },
          availableZ: [0, 1, 2, 3],
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
          availableZ: [0, 1, 2],
        }),
      ],
    },
  ]

  for (const groupCount of [1, 2]) {
    const inputProblem: TopologyMergingSolverParams = {
      layerCount: 4,
      nodeGroups: nodeGroups.slice(0, groupCount),
    }
    const reference = new TopologyMergingSolver(inputProblem)
    const referenceWorkspace = reference as unknown as TopologyMergingWorkspace
    // Keep the legacy completed state as an output and visualization control.
    referenceWorkspace.releaseConstructionWorkspace = (): void => {}
    reference.solve()

    const solver = new TopologyMergingSolver(inputProblem)
    const workspace = solver as unknown as TopologyMergingWorkspace
    expect(workspace.preparedNodes).toHaveLength(groupCount)
    expect(workspace.preparedNodeBySourceKey.size).toBe(groupCount)
    expect(workspace.xCoordinates.length).toBeGreaterThan(0)
    expect(() => solver.getOutput()).toThrow("before the solver completed")
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(workspace.preparedNodes).toHaveLength(0)
    expect(workspace.preparedNodeBySourceKey.size).toBe(0)
    expect(workspace.xCoordinates).toHaveLength(0)
    expect(workspace.atomicRegions).toHaveLength(0)
    expect(workspace.outputProvenance.groupIndexesByNodeId.size).toBe(0)
    expect(workspace.outputProvenance.sourceKeysByNodeId.size).toBe(0)
    expect(referenceWorkspace.preparedNodes).toHaveLength(groupCount)
    expect(
      referenceWorkspace.outputProvenance.sourceKeysByNodeId.size,
    ).toBeGreaterThan(0)
    expect(solver.getOutput()).toEqual(reference.getOutput())
    expect(solver.visualize()).toEqual(reference.visualize())
    expect(solver.stats).toEqual(reference.stats)
    expect(solver.getConstructorParams()[0]).toBe(inputProblem)
    expect(solver.computeProgress()).toBe(1)

    if (groupCount === 1) {
      expect(solver.getOutput()).toBe(inputProblem.nodeGroups[0]!.nodes)
    } else {
      expect(referenceWorkspace.atomicRegions.length).toBeGreaterThan(0)
      expect(solver.stats.atomicRegionCount).toBeGreaterThan(0)
    }
  }
})
