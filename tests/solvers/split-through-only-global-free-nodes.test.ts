import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { splitThroughOnlyGlobalFreeNodes } from "lib/solvers/NodeDimensionSubdivisionSolver/splitThroughOnlyGlobalFreeNodes"
import type { CapacityMeshNode } from "lib/types"

test("through-only planning splits partial free stacks without fabricating vertical edges or changing owned copper", (): void => {
  const partial: CapacityMeshNode = {
    capacityMeshNodeId: "partial-free",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    layer: "z1,2,3,5",
    availableZ: [1, 2, 3, 5],
  }
  const full: CapacityMeshNode = {
    capacityMeshNodeId: "full-free",
    center: { x: 1, y: 0 },
    width: 1,
    height: 1,
    layer: "z0,1,2,3,4,5,6,7",
    availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
  }
  const ownedPth: CapacityMeshNode = {
    capacityMeshNodeId: "owned-pth",
    center: { x: 5, y: 0 },
    width: 1,
    height: 1,
    layer: full.layer,
    availableZ: [...full.availableZ],
    _containsObstacle: true,
    _containsTarget: true,
    _connectedTo: ["owner"],
  }
  const input = [partial, full, ownedPth]
  const snapshot = structuredClone(input)
  const policy = { layerCount: 8, allowBlindAndBuriedVias: false }
  const output = splitThroughOnlyGlobalFreeNodes(input, policy)
  expect(output).toHaveLength(6)
  expect(output.slice(0, 4).map((node) => node.availableZ)).toEqual([
    [1],
    [2],
    [3],
    [5],
  ])
  expect(output[4]).toBe(full)
  expect(output[5]).toBe(ownedPth)
  expect(new Set(output.map((node) => node.capacityMeshNodeId)).size).toBe(
    output.length,
  )
  expect(input).toEqual(snapshot)
  for (const z of full.availableZ) {
    const inputArea = input
      .filter((node) => node.availableZ.includes(z))
      .reduce((area, node) => area + node.width * node.height, 0)
    const outputArea = output
      .filter((node) => node.availableZ.includes(z))
      .reduce((area, node) => area + node.width * node.height, 0)
    expect(outputArea).toBe(inputArea)
  }
  for (const node of output.slice(0, 4)) {
    expect(node.center).toEqual(partial.center)
    expect(node.width).toBe(partial.width)
    expect(node.height).toBe(partial.height)
  }
  const edges = new CapacityMeshEdgeSolver2_NodeTreeOptimization(output)
  edges.solve()
  expect(edges.edges).toHaveLength(4)
  expect(
    edges.edges.every((edge) => edge.nodeIds.includes(full.capacityMeshNodeId)),
  ).toBe(true)
  // Only the adjacent full-stack box can join the partial stack's layers.
  expect(output.slice(0, 4).every((node) => node.availableZ.length === 1)).toBe(
    true,
  )
  expect(ownedPth.availableZ).toHaveLength(8)
  expect(
    splitThroughOnlyGlobalFreeNodes(input, {
      ...policy,
      allowBlindAndBuriedVias: true,
    }),
  ).toBe(input)
  expect(
    splitThroughOnlyGlobalFreeNodes(input, {
      ...policy,
      allowViaInPad: true,
    })
      .slice(0, 4)
      .map((node) => node.availableZ),
  ).toEqual([[1], [2], [3], [5]])
  for (const role of [
    { _containsObstacle: true },
    { _containsTarget: true },
    { _isComponentTopologyNode: true },
    { _isNarrowQfpPadGap: true },
    { _connectedTo: ["owner"] },
    { _targetConnectionName: "owner" },
    { _parent: full },
    { unknownRole: false },
  ]) {
    const protectedNode = { ...partial, ...role } as CapacityMeshNode
    const nodes = [protectedNode]
    expect(splitThroughOnlyGlobalFreeNodes(nodes, policy)).toBe(nodes)
  }
  const collidingId = {
    ...full,
    capacityMeshNodeId: "partial-free__single_z1",
  }
  const collisionOutput = splitThroughOnlyGlobalFreeNodes(
    [partial, collidingId],
    policy,
  )
  expect(
    new Set(collisionOutput.map((node) => node.capacityMeshNodeId)).size,
  ).toBe(collisionOutput.length)
  expect(collisionOutput.at(-1)).toBe(collidingId)
})
