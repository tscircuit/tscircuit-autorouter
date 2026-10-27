import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { getLayerTopologiesForCoveredNodes } from "lib/solvers/TopologyMergingSolver/topology-merging-regions"
import { prepareTopologyMergingInput } from "lib/solvers/TopologyMergingSolver/topology-merging-input"
import type { TopologyMergingSolverParams } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import type { CapacityMeshNode } from "lib/types"
import actual from "../fixtures/sample24-u4-layer-topology-roi.json"

test("common XY refinement restores complete free layer stacks without merging owned or ambiguous topology", () => {
  const input = structuredClone(actual) as TopologyMergingSolverParams
  const before = JSON.stringify(input)
  const solver = new TopologyMergingSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  const output = solver.getOutput()
  for (const point of [{ x: 177.3, y: 100.2 }, { x: 177.3, y: 101.0 }, { x: 177.3, y: 101.7 }]) {
    const covering = output.filter((node) => Math.abs(point.x - node.center.x) < node.width / 2 &&
      Math.abs(point.y - node.center.y) < node.height / 2)
    expect(covering.length).toBe(1)
    expect(covering[0]!.availableZ).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(covering[0]!._containsObstacle).toBeUndefined()
    expect(covering[0]!._containsTarget).toBeUndefined()
    expect(covering[0]!.width).toBeGreaterThan(0.3)
  }
  expect(JSON.stringify(input)).toBe(before)
  const sources = input.nodeGroups.flatMap((group) => group.nodes)
  for (const node of output) {
    for (const z of node.availableZ) {
      expect(sources.some((source) => source.availableZ.includes(z) &&
        node.center.x - node.width / 2 >= source.center.x - source.width / 2 - 4e-5 &&
        node.center.x + node.width / 2 <= source.center.x + source.width / 2 + 4e-5 &&
        node.center.y - node.height / 2 >= source.center.y - source.height / 2 - 4e-5 &&
        node.center.y + node.height / 2 <= source.center.y + source.height / 2 + 4e-5)).toBe(true)
    }
  }
  const free = (id: string, zs: number[]): CapacityMeshNode => ({
    capacityMeshNodeId: id, center: { x: 0, y: 0 }, width: 2, height: 2, layer: "top", availableZ: zs,
  })
  const groups = [{ groupId: "global", isComponent: false, nodes: [free("top", [0]), free("bottom", [1])] }]
  const topologies = (nodes: CapacityMeshNode[], layerCount = 2) => getLayerTopologiesForCoveredNodes({
    coveringNodes: prepareTopologyMergingInput({ layerCount, nodeGroups: [{ ...groups[0]!, nodes }] }).preparedNodes,
    nodeGroups: [{ ...groups[0]!, nodes }], layerCount,
  })
  expect(topologies(groups[0]!.nodes).map((t) => t.availableZ)).toEqual([[0, 1]])
  expect(topologies([free("top", [0])]).map((t) => t.availableZ)).toEqual([[0]])
  expect(topologies([free("top", [0]), free("bottom", [1])], 3).every((t) => t.availableZ.length === 1)).toBe(true)
  expect(topologies([...groups[0]!.nodes, free("overlap-top", [0])]).every((t) => t.availableZ.length === 1)).toBe(true)
  for (const metadata of [
    { _containsTarget: true }, { _containsObstacle: true }, { _connectedTo: ["owner"] },
    { _targetConnectionName: "owner" }, { _isVirtualOffboard: true }, { netId: 0 },
    { _isNarrowQfpPadGap: true }, { _qfpRegionType: "pad" as const },
  ]) {
    expect(topologies([free("top", [0]), { ...free("bottom", [1]), ...metadata }]).every((t) => t.availableZ.length === 1)).toBe(true)
  }
})
