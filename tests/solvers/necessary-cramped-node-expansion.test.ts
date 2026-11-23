import { expect, spyOn, test } from "bun:test"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { SingleTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/SingleTargetNecessaryCrampedPortPointSolver"
import type { ExploredPortPoint } from "lib/solvers/NecessaryCrampedPortPointSolver/types"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"

test("cramped escape search preserves tie paths and revisits cheaper node approaches", (): void => {
  const nodes: CapacityMeshNode[] = [
    "pad",
    "channel",
    "shared",
    "outside",
    "destination",
  ].map((capacityMeshNodeId, index) => ({
    capacityMeshNodeId,
    center: { x: index, y: 0 },
    width: 1,
    height: 1,
    availableZ: [0],
    layer: "z0",
  }))
  const crossings: [string, CapacityMeshNodeId, CapacityMeshNodeId, boolean][] =
    [
      ["direct-cramped", "pad", "shared", true],
      ["channel-first", "pad", "channel", false],
      ["channel-tie", "pad", "channel", false],
      ["channel-exit", "channel", "shared", false],
      ["shared-exit", "shared", "outside", false],
      ["destination-entry", "outside", "destination", false],
    ]
  const ports: SegmentPortPoint[] = crossings.map(
    ([segmentPortPointId, first, second, cramped], index) => ({
      segmentPortPointId,
      edgeId: `edge${index}`,
      nodeIds: [first, second],
      x: index,
      y: 0,
      availableZ: [0],
      connectionName: null,
      distToCentermostPortOnZ: 0,
      cramped,
    }),
  )
  const nodeMap = new Map(nodes.map((node) => [node.capacityMeshNodeId, node]))
  for (const shouldIgnoreCrampedPortPoints of [false, true]) {
    const portsByNodeId = new Map<CapacityMeshNodeId, SegmentPortPoint[]>()
    for (const node of nodes) {
      portsByNodeId.set(
        node.capacityMeshNodeId,
        ports.filter((port) => port.nodeIds.includes(node.capacityMeshNodeId)),
      )
    }
    const reads = spyOn(portsByNodeId, "get")
    const solver = new SingleTargetNecessaryCrampedPortPointSolver({
      target: nodes[0]!,
      mapOfCapacityMeshNodeIdToSegmentPortPoints: portsByNodeId,
      mapOfCapacityMeshNodeIdToRef: nodeMap,
      depthLimit: 3,
      shouldIgnoreCrampedPortPoints,
    })
    solver.solve()
    const paths = solver.getOutput().map((candidate): string[] => {
      const path: string[] = []
      let parent: ExploredPortPoint | null = candidate
      while (parent) {
        path.unshift(parent.port.segmentPortPointId)
        parent = parent.parent
      }
      return path
    })
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(paths).toEqual(
      shouldIgnoreCrampedPortPoints
        ? [["channel-first", "channel-exit", "shared-exit"]]
        : [
            ["direct-cramped", "shared-exit", "destination-entry"],
            ["channel-first", "channel-exit", "shared-exit"],
          ],
    )
    expect(
      solver
        .getOutput()
        .map((candidate) => candidate.countOfCrampedPortPointsInPath),
    ).toEqual(shouldIgnoreCrampedPortPoints ? [0] : [1, 0])
    expect(
      reads.mock.calls.filter(([nodeId]) => nodeId === "channel"),
    ).toHaveLength(1)
    expect(
      reads.mock.calls.filter(([nodeId]) => nodeId === "shared"),
    ).toHaveLength(shouldIgnoreCrampedPortPoints ? 1 : 2)
    reads.mockRestore()
  }
})
