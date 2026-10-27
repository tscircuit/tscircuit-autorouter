import { expect, test } from "bun:test"
import type { InputNodeWithPortPoints, InputPortPoint } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver, type UniformPortDistributionSolverInput } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { shouldIgnorePortPoint } from "lib/solvers/UniformPortDistributionSolver/shouldIgnorePortPoint"
import type { OwnerPair } from "lib/solvers/UniformPortDistributionSolver/types"
import type { PortPoint } from "lib/types/high-density-types"

// Exact previous lookup behavior, retained here as an independent semantic reference.
function legacyIgnore(portPoint: PortPoint, ownerNodeIds: OwnerPair, inputNodes: InputNodeWithPortPoints[]): boolean {
  for (const ownerNodeId of ownerNodeIds) {
    const inputNode = inputNodes.find((n) => n.capacityMeshNodeId === ownerNodeId)
    if (inputNode?._containsTarget) return true
    const inputPortPoint = inputNode?.portPoints.find((p) => p.portPointId === portPoint.portPointId)
    if (inputPortPoint?.connectionNodeIds?.some((id) => inputNodes.find((n) => n.capacityMeshNodeId === id)?._containsTarget)) return true
  }
  return false
}

function makeNode(id: string, target: boolean, portPoints: InputPortPoint[]): InputNodeWithPortPoints {
  return {
    capacityMeshNodeId: id,
    center: { x: id === "b" ? 1 : -1, y: 0 },
    width: 2, height: 4, availableZ: [0],
    _containsTarget: target,
    portPoints,
  }
}

function fullInput(target: boolean): UniformPortDistributionSolverInput {
  const points: PortPoint[] = [-1.7, -0.2, 0.6, 1.7].map((y, index) => ({
    portPointId: `p${index}`, connectionName: `net${index}`, x: 0, y, z: 0,
  }))
  const sourcePoints: InputPortPoint[] = points.map((point) => ({
    portPointId: point.portPointId!, x: point.x, y: point.y, z: point.z,
    connectionNodeIds: ["a", "b"], distToCentermostPortOnZ: Math.abs(point.y),
  }))
  const a = makeNode("a", target, structuredClone(sourcePoints))
  return {
    nodeWithPortPoints: ["a", "b"].map((id) => ({
      capacityMeshNodeId: id, center: { x: id === "a" ? -1 : 1, y: 0 }, width: 2, height: 4,
      availableZ: [0], portPoints: structuredClone(points),
      portPointsInPairs: [[structuredClone(points[0]), structuredClone(points[3])], [structuredClone(points[1]), structuredClone(points[2])]],
    })),
    inputNodesWithPortPoints: [a, makeNode("a", !target, structuredClone(sourcePoints)), makeNode("b", false, structuredClone(sourcePoints))],
    obstacles: [], layerCount: 2, useLayerAwareGeometry: true,
  }
}

test("uniform input-node indexing preserves first matches, target decisions and final redistribution", (): void => {
  const point = (id: string, owners: [string, string]): InputPortPoint => ({
    portPointId: id,
    x: 0,
    y: 0,
    z: 0,
    connectionNodeIds: owners,
    distToCentermostPortOnZ: 0,
  })
  const nodes = [
    makeNode("a", false, [point("free", ["a", "b"]), point("locked", ["target", "missing"]), point("duplicate", ["a", "b"]), point("duplicate", ["target", "b"])]),
    makeNode("a", true, [point("free", ["target", "b"])]),
    makeNode("b", false, []),
    makeNode("target", true, []),
    makeNode("target", false, []),
  ]
  const before = structuredClone(nodes)
  const holder = new UniformPortDistributionSolver({ nodeWithPortPoints: [], inputNodesWithPortPoints: nodes, obstacles: [] })
  const index = (holder as unknown as { inputNodesById: ReadonlyMap<string, InputNodeWithPortPoints> }).inputNodesById
  expect(index.size).toBe(3)
  expect(index.get("a")).toBe(nodes[0])
  expect(index.get("b")).toBe(nodes[2])
  expect(index.get("target")).toBe(nodes[3])
  expect(index.get("missing")).toBeUndefined()
  const ownerPairs: OwnerPair[] = [["a", "b"], ["a", "missing"], ["missing", "b"], ["target", "b"], ["missing", "unknown"]]
  for (const ownerNodeIds of ownerPairs) {
    for (const id of ["free", "locked", "duplicate", "missing", undefined]) {
      const portPoint: PortPoint = { portPointId: id, connectionName: "net", x: 0, y: 0, z: 0 }
      expect(shouldIgnorePortPoint({ portPoint, ownerNodeIds, inputNodesById: index })).toBe(legacyIgnore(portPoint, ownerNodeIds, nodes))
    }
  }
  const free: PortPoint = { portPointId: "free", connectionName: "net", x: 0, y: 0, z: 0 }
  const locked = { ...free, portPointId: "locked" }
  expect(shouldIgnorePortPoint({ portPoint: free, ownerNodeIds: ["a", "b"], inputNodesById: index })).toBe(false)
  expect(shouldIgnorePortPoint({ portPoint: locked, ownerNodeIds: ["a", "b"], inputNodesById: index })).toBe(true)
  expect(shouldIgnorePortPoint({ portPoint: { ...free, portPointId: "duplicate" }, ownerNodeIds: ["a", "b"], inputNodesById: index })).toBe(false)
  // The index keeps source object references, so later flag reads retain the
  // exact Array.find behavior instead of reading stale cloned metadata.
  nodes[0]._containsTarget = true
  expect(shouldIgnorePortPoint({ portPoint: free, ownerNodeIds: ["a", "b"], inputNodesById: index })).toBe(true)
  nodes[0]._containsTarget = false
  nodes[3]._containsTarget = false
  expect(shouldIgnorePortPoint({ portPoint: locked, ownerNodeIds: ["a", "b"], inputNodesById: index })).toBe(false)
  nodes[3]._containsTarget = true
  expect(nodes).toEqual(before)

  for (const target of [false, true]) {
    const input = fullInput(target), initial = structuredClone(input)
    const solver = new UniformPortDistributionSolver(input)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(input).toEqual(initial)
    const expectedY = target ? [-1.7, -0.2, 0.6, 1.7] : [-1.5, -0.5, 0.5, 1.5]
    for (const node of solver.getOutput()) {
      expect(node.portPoints.map((p) => p.y)).toEqual(expectedY)
      expect(node.portPoints.map((p) => p.x)).toEqual([0, 0, 0, 0])
      expect(node.portPoints.map((p) => p.portPointId)).toEqual(["p0", "p1", "p2", "p3"])
      expect(node.portPoints.map((p) => p.connectionName)).toEqual(["net0", "net1", "net2", "net3"])
      expect(node.portPointsInPairs?.map((pair) => pair.map((p) => p.y))).toEqual([[expectedY[0], expectedY[3]], [expectedY[1], expectedY[2]]])
    }
    const repeated = new UniformPortDistributionSolver(structuredClone(initial))
    repeated.solve()
    expect(repeated.getOutput()).toEqual(solver.getOutput())
  }
})
