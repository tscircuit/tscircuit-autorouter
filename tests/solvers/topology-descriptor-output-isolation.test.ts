import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "../../lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import type { TopologyMergingOutputProvenance } from "../../lib/solvers/TopologyMergingSolver/topology-merging-output"
import type {
  TopologyMergingLayerTopology,
  TopologyMergingRegion,
  TopologyMergingSolverParams,
} from "../../lib/solvers/TopologyMergingSolver/topology-merging-types"

type PrivateDescriptors = {
  atomicRegions: TopologyMergingRegion[]
  layerTopologyByKey: Map<string, TopologyMergingLayerTopology>
  outputProvenance: TopologyMergingOutputProvenance
}

test("mixed-layer topology descriptors stay private while outputs retain independent arrays", (): void => {
  const input: TopologyMergingSolverParams = {
    layerCount: 2,
    nodeGroups: [
      {
        groupId: "global",
        isComponent: false,
        nodes: [
          { capacityMeshNodeId: "free", center: { x: 0, y: 0 }, width: 6, height: 4, layer: "z0,1", availableZ: [0, 1] },
          {
            capacityMeshNodeId: "target",
            center: { x: 5, y: 0 }, width: 2, height: 2, layer: "z0,1", availableZ: [0, 1],
            _containsObstacle: true, _containsTarget: true,
            _targetConnectionName: "net-target", _connectedTo: ["net-target"],
          },
        ],
      },
      {
        groupId: "local",
        isComponent: true,
        nodes: [{ capacityMeshNodeId: "free", center: { x: 0, y: 0 }, width: 2, height: 2, layer: "z0", availableZ: [0] }],
      },
    ],
  }
  const inputBefore = JSON.stringify(input)
  for (const group of input.nodeGroups) {
    for (const node of group.nodes) {
      Object.freeze(node.availableZ)
      Object.freeze(node.center)
      if (node._connectedTo) Object.freeze(node._connectedTo)
      Object.freeze(node)
    }
    Object.freeze(group.nodes)
    Object.freeze(group)
  }
  Object.freeze(input.nodeGroups)
  Object.freeze(input)
  const solver = new TopologyMergingSolver(input)
  while (solver.stats.processedXSlabCount < solver.stats.xSlabCount) solver.step()
  expect(solver.solved).toBe(false)
  const internals = solver as unknown as PrivateDescriptors
  const descriptors = [...internals.layerTopologyByKey.values()]
  const globalOnly = descriptors.filter((entry) => entry.sourceKeys.length === 1 && entry.sourceKeys[0] === "global:free")
  expect(globalOnly.map((entry) => entry.availableZ)).toEqual([[0, 1], [1]])
  expect(globalOnly[0]!.topologySignature).toBe(globalOnly[1]!.topologySignature)
  expect(globalOnly[0]!.availableZ).not.toBe(globalOnly[1]!.availableZ)
  const reused = internals.atomicRegions.filter((region) => region.availableZ === globalOnly[0]!.availableZ)
  expect(reused.length).toBeGreaterThan(1)
  expect(reused.every((region) => region.sourceKeys === globalOnly[0]!.sourceKeys)).toBe(true)
  const descriptorsBefore = JSON.stringify(descriptors)
  const atomicBefore = JSON.stringify(internals.atomicRegions)
  for (const descriptor of descriptors) {
    Object.freeze(descriptor.availableZ)
    Object.freeze(descriptor.sourceKeys)
    Object.freeze(descriptor)
  }
  for (const region of internals.atomicRegions) {
    Object.freeze(region.bounds)
    Object.freeze(region)
  }
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(JSON.stringify(internals.atomicRegions)).toBe(atomicBefore)
  const output = solver.getOutput()
  const overlap = output.filter((node) => node.center.x === 0 && node.center.y === 0 && node.width === 2 && node.height === 2)
  expect(overlap.map((node) => node.availableZ)).toEqual([[0], [1]])
  expect(overlap.map((node) => internals.outputProvenance.sourceKeysByNodeId.get(node.capacityMeshNodeId))).toEqual([
    ["global:free", "local:free"], ["global:free"],
  ])
  const target = output.find((node) => node.capacityMeshNodeId === "target")!
  expect(target).toBeDefined()
  expect(target).toMatchObject({
    center: { x: 5, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
    _containsObstacle: true, _containsTarget: true,
    _targetConnectionName: "net-target", _connectedTo: ["net-target"],
  })
  const sourceArrays = [...internals.outputProvenance.sourceKeysByNodeId.values()]
  const groupArrays = [...internals.outputProvenance.groupIndexesByNodeId.values()]
  for (const node of output) {
    expect(descriptors.some((entry) => entry.availableZ === node.availableZ)).toBe(false)
    expect(input.nodeGroups.some((group) => group.nodes.some((source) => source.availableZ === node.availableZ))).toBe(false)
  }
  expect(new Set(output.map((node) => node.availableZ)).size).toBe(output.length)
  expect(new Set(sourceArrays).size).toBe(output.length)
  expect(new Set(groupArrays).size).toBe(output.length)
  expect(sourceArrays.some((keys) => descriptors.some((entry) => entry.sourceKeys === keys))).toBe(false)
  const untouchedOutput = JSON.stringify(output.slice(1))
  const untouchedSources = JSON.stringify(sourceArrays.slice(1))
  const untouchedGroups = JSON.stringify(groupArrays.slice(1))
  output[0]!.availableZ.push(7)
  output[0]!.center.x += 100
  sourceArrays[0]!.push("consumer-mutation")
  groupArrays[0]!.push(99)
  expect(JSON.stringify(output.slice(1))).toBe(untouchedOutput)
  expect(JSON.stringify(sourceArrays.slice(1))).toBe(untouchedSources)
  expect(JSON.stringify(groupArrays.slice(1))).toBe(untouchedGroups)
  expect(JSON.stringify(descriptors)).toBe(descriptorsBefore)
  expect(JSON.stringify(internals.atomicRegions)).toBe(atomicBefore)
  expect(JSON.stringify(input)).toBe(inputBefore)
})
