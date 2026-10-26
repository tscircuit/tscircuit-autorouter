import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import type { CapacityMeshNode } from "lib/types"
import {
  createTopologyMergingTestNode,
  getAvailableZAtPoint,
} from "../fixtures/topology-merging-test-utils"

type SolverProvenance = {
  outputProvenance: { sourceKeysByNodeId: Map<string, string[]> }
}

function createPartitionedFreeNodes(): CapacityMeshNode[] {
  const nodes: CapacityMeshNode[] = []
  for (let z = 0; z < 8; z++) {
    const xs = [0, 0.7 + z * 0.05, 3]
    const ys = [0, 0.6 + z * 0.05, 2]
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 2; y++) {
        nodes.push(
          createTopologyMergingTestNode({
            id: `free-z${z}-${x}-${y}`,
            bounds: {
              minX: xs[x]!,
              maxX: xs[x + 1]!,
              minY: ys[y]!,
              maxY: ys[y + 1]!,
            },
            availableZ: [z],
          }),
        )
      }
    }
  }
  return nodes
}

function createSolver(
  globalNodes: CapacityMeshNode[],
  globalIsComponent = false,
): TopologyMergingSolver {
  return new TopologyMergingSolver({
    layerCount: 8,
    nodeGroups: [
      { groupId: "global", isComponent: globalIsComponent, nodes: globalNodes },
      {
        groupId: "remote-component",
        isComponent: true,
        nodes: [
          createTopologyMergingTestNode({
            id: "remote",
            bounds: { minX: 10, maxX: 11, minY: 0, maxY: 1 },
            availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
          }),
        ],
      },
    ],
  })
}

test("full-stack global free space retains legal vias across different layer partitions", (): void => {
  const globalNodes = createPartitionedFreeNodes()
  const snapshot = structuredClone(globalNodes)
  const solver = createSolver(globalNodes)
  solver.solve()
  expect(solver.solved).toBe(true)
  const output = solver.getOutput()
  const free = output.filter((node) => node.center.x < 3)
  expect(free).toHaveLength(1)
  expect(free[0]!.availableZ).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  expect(free[0]!.center).toEqual({ x: 1.5, y: 1 })
  expect(free[0]!.width).toBe(3)
  expect(free[0]!.height).toBe(2)
  // A .3mm through via plus .15mm surrounding clearance fits in the region.
  expect(free[0]!.width).toBeGreaterThan(0.3 + 2 * 0.15)
  expect(free[0]!.height).toBeGreaterThan(0.3 + 2 * 0.15)
  const provenance = (
    solver as unknown as SolverProvenance
  ).outputProvenance.sourceKeysByNodeId.get(free[0]!.capacityMeshNodeId)
  expect(provenance).toEqual(
    globalNodes.map((node) => `global:${node.capacityMeshNodeId}`).sort(),
  )
  expect(globalNodes).toEqual(snapshot)

  // Sample024's C52 bottom copper must continue to block a through via even
  // when top and every inner layer are free at the same XY point.
  const bottomCopper = {
    ...createTopologyMergingTestNode({
      id: "bottom-copper",
      bounds: { minX: 1.35, maxX: 1.65, minY: 0.7, maxY: 1.3 },
      availableZ: [7],
    }),
    _containsObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "foreign",
    _connectedTo: ["foreign"],
  }
  const blocked = createSolver([...globalNodes, bottomCopper])
  blocked.solve()
  const blockedOutput = blocked.getOutput()
  expect(
    getAvailableZAtPoint(
      blockedOutput.filter((node) => !node._containsObstacle),
      { x: 1.5, y: 1 },
    ),
  ).toEqual([[0], [1], [2], [3], [4], [5], [6]])
  expect(
    blockedOutput.find((node) => node.capacityMeshNodeId === "bottom-copper"),
  ).toMatchObject(bottomCopper)
  const partial = createSolver(
    globalNodes.filter((node) => !node.availableZ.includes(7)),
  )
  partial.solve()
  expect(getAvailableZAtPoint(partial.getOutput(), { x: 1.5, y: 1 })).toEqual([
    [0],
    [1],
    [2],
    [3],
    [4],
    [5],
    [6],
  ])

  for (const role of [
    { _containsObstacle: true },
    { _containsTarget: true },
    { _isNarrowQfpPadGap: true },
    { _isComponentTopologyNode: true },
    { _connectedTo: ["net"] },
    { _targetConnectionName: "net" },
    { _qfpRegionType: "pad-gap" },
    { _soicRegionType: "pad-gap" },
    { _parent: globalNodes[0] },
    { unknownRole: false },
  ]) {
    const protectedInput = globalNodes.map((node) =>
      node.availableZ.includes(0)
        ? ({ ...node, ...role } as CapacityMeshNode)
        : node,
    )
    const protectedSolver = createSolver(protectedInput)
    protectedSolver.solve()
    expect(
      getAvailableZAtPoint(protectedSolver.getOutput(), { x: 1.5, y: 1 }),
    ).toEqual([[0], [1], [2], [3], [4], [5], [6], [7]])
  }
  const component = createSolver(globalNodes, true)
  component.solve()
  expect(getAvailableZAtPoint(component.getOutput(), { x: 1.5, y: 1 })).toEqual(
    [[0], [1], [2], [3], [4], [5], [6], [7]],
  )
})
