import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import type { CapacityMeshNode } from "lib/types"
import {
  createTopologyMergingTestNode,
  solveTopologyMergingTestGroups,
} from "../fixtures/topology-merging-test-utils"

test("physical pad fragments retain their existing copper escape while isolated targets still fail", (): void => {
  const pad: CapacityMeshNode = {
    ...createTopologyMergingTestNode({
      id: "physical-pad",
      bounds: { minX: 0, maxX: 3, minY: 0, maxY: 3 },
      availableZ: [0],
    }),
    _soicRegionType: "pad",
    _containsObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "signal",
    _connectedTo: ["pad-port"],
  }
  const existingCopper: CapacityMeshNode = {
    ...createTopologyMergingTestNode({
      id: "existing-copper",
      bounds: { minX: 1.2, maxX: 3.2, minY: 1.4, maxY: 1.6 },
      availableZ: [0],
    }),
    _containsObstacle: true,
    _containsTarget: true,
    _connectedTo: ["pad-port", "other-port"],
  }
  const free = createTopologyMergingTestNode({
    id: "free",
    bounds: { minX: -1, maxX: 4, minY: -1, maxY: 4 },
    availableZ: [0],
  })
  const input = structuredClone([pad, existingCopper, free])
  const merged = solveTopologyMergingTestGroups([
    { groupId: "global", nodes: [free, existingCopper], isComponent: false },
    { groupId: "component", nodes: [pad], isComponent: true },
  ])
  const subdivision = new NodeDimensionSubdivisionSolver(merged, 0.5, 6, 0)
  subdivision.solve()
  const nodes = subdivision.outputNodes
  const edgeSolver = new CapacityMeshEdgeSolver(nodes)
  edgeSolver.solve()
  expect(edgeSolver.solved).toBeTrue()
  const byId = new Map(nodes.map((node) => [node.capacityMeshNodeId, node]))
  const internalTargets = nodes.filter(
    (node) =>
      node._targetConnectionName === "signal" &&
      !edgeSolver.edges.some((edge) => {
        if (!edge.nodeIds.includes(node.capacityMeshNodeId)) return false
        const other = byId.get(
          edge.nodeIds.find((id) => id !== node.capacityMeshNodeId)!,
        )!
        return !other._containsObstacle && !other._containsTarget
      }),
  )
  expect(internalTargets.length).toBeGreaterThan(0)
  const segments = new AvailableSegmentPointSolver({
    nodes,
    edges: edgeSolver.edges,
    traceWidth: 0.1,
    shouldReturnCrampedPortPoints: true,
  })
  segments.solve()
  for (const target of internalTargets) {
    expect(target._physicalTargetRegions?.[0]?.id).toBe(
      "component:physical-pad",
    )
    expect(
      segments.getOutput().some(
        (segment) =>
          segment.nodeIds.includes(target.capacityMeshNodeId) &&
          segment.portPoints.length > 0,
      ),
    ).toBeTrue()
  }
  expect([pad, existingCopper, free]).toEqual(input)

  const provenanceCases: Array<{
    overrides: Partial<CapacityMeshNode>
    expectedRegions: number
  }> = [
    { overrides: {}, expectedRegions: 1 },
    { overrides: { center: { x: 10, y: 1.5 } }, expectedRegions: 0 },
    { overrides: { center: { x: 4, y: 1.5 } }, expectedRegions: 0 },
    { overrides: { availableZ: [1], layer: "z1" }, expectedRegions: 0 },
    { overrides: { _targetConnectionName: "foreign" }, expectedRegions: 0 },
    { overrides: { _connectedTo: ["foreign-port"] }, expectedRegions: 0 },
  ]
  for (const { overrides, expectedRegions } of provenanceCases) {
    const output = solveTopologyMergingTestGroups([
      {
        groupId: "global",
        nodes: [free, { ...existingCopper, ...overrides }],
        isComponent: false,
      },
      { groupId: "component", nodes: [pad], isComponent: true },
    ])
    const copper = output.find(
      (node) => node.capacityMeshNodeId === existingCopper.capacityMeshNodeId,
    )!
    expect(copper._physicalTargetRegions ?? []).toHaveLength(expectedRegions)
  }

  for (const globalNodes of [
    [
      createTopologyMergingTestNode({
        id: "remote-free",
        bounds: { minX: 10, maxX: 11, minY: 10, maxY: 11 },
        availableZ: [0],
      }),
    ],
    [{ ...free, availableZ: [1], layer: "z1" }],
    [
      {
        ...existingCopper,
        center: { x: 4, y: 1.5 },
        width: 2,
        height: 1,
      },
      createTopologyMergingTestNode({
        id: "free-beyond-unproven-copper",
        bounds: { minX: 5, maxX: 6, minY: 1, maxY: 2 },
        availableZ: [0],
      }),
    ],
  ]) {
    const isolated = solveTopologyMergingTestGroups([
      { groupId: "global", nodes: globalNodes, isComponent: false },
      { groupId: "component", nodes: [pad], isComponent: true },
    ])
    const split = new NodeDimensionSubdivisionSolver(isolated, 0.5, 6, 0)
    split.solve()
    const solver = new CapacityMeshEdgeSolver(split.outputNodes)
    expect(() => solver.solve()).toThrow("has no bordering routing edge")
  }
})
