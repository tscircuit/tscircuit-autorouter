import { expect, test } from "bun:test"
import { getCapacityMeshNodeBounds, getBoundsIntersection } from "lib/solvers/TopologyPlanningSolver/capacity-node-geometry"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import type { CapacityMeshNode } from "lib/types"

test("topology merging preserves a fixed power escape without restoring its overlapping component pad", (): void => {
  // The AM3352 CPU A2 pad and its fixed top escape from the native POWER phase.
  const fixedEscape: CapacityMeshNode = {
    capacityMeshNodeId: "cmn_2415",
    center: { x: -7.043478260869566, y: -5.756521739130434 },
    width: 0.16956521739130448,
    height: 0.16956521739130448,
    layer: "top",
    availableZ: [0],
    _containsObstacle: true,
    _containsTarget: true,
    _connectedTo: ["pcb_port_18"],
  }
  const componentPad: CapacityMeshNode = {
    capacityMeshNodeId: "cpu-a2-pad",
    center: { x: -6.800000000000001, y: -6 },
    width: 0.4,
    height: 0.4,
    layer: "z0",
    availableZ: [0],
    _containsObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "source_net_76",
  }
  const input = {
    layerCount: 4,
    nodeGroups: [
      { groupId: "global", nodes: [fixedEscape], isComponent: false },
      { groupId: "cpu", nodes: [componentPad], isComponent: true },
    ],
  }
  const originalInput = JSON.stringify(input)
  const solver = new TopologyMergingSolver(input)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const output = solver.getOutput()
  expect(JSON.stringify(input)).toBe(originalInput)
  const preservedEscape = output.find((node) => node.capacityMeshNodeId === "cmn_2415")!
  expect(preservedEscape).toMatchObject({
    center: fixedEscape.center,
    availableZ: [0],
    _containsObstacle: true,
    _containsTarget: true,
    _connectedTo: ["pcb_port_18"],
  })
  expect(preservedEscape.width).toBeCloseTo(fixedEscape.width, 12)
  expect(preservedEscape.height).toBeCloseTo(fixedEscape.height, 12)
  const padRegions = output.filter((node) => node._isComponentTopologyNode)
  expect(padRegions.length).toBeGreaterThan(0)
  const originalOverlap = getBoundsIntersection(
    getCapacityMeshNodeBounds(fixedEscape),
    getCapacityMeshNodeBounds(componentPad),
  )!
  const overlapArea =
    (originalOverlap.maxX - originalOverlap.minX) *
    (originalOverlap.maxY - originalOverlap.minY)
  expect(padRegions.reduce((area, node) => area + node.width * node.height, 0))
    .toBeCloseTo(componentPad.width * componentPad.height - overlapArea, 10)
  for (const region of padRegions) {
    expect(region.availableZ).toEqual([0])
    expect(region._targetConnectionName).toBe("source_net_76")
    expect(getBoundsIntersection(
      getCapacityMeshNodeBounds(region),
      getCapacityMeshNodeBounds(fixedEscape),
    )).toBeNull()
  }
})
