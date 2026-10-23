import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { annotatePipeline9PhysicalCuts, createPhysicalCutTracker } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/pipeline9PhysicalCutResources"

test("physical interface/layer cut inequality preserves every slot and excludes fixed or off-contract ports", () => {
  const graph: SerializedHyperGraph = {
    regions: ["left", "right"].map((id, i) => ({ regionId: id, pointIds: ["a", "b", "c"], d: { center: { x: i === 0 ? -1 : 1, y: 0 }, width: 2, height: 0.1, availableZ: [0, 1] } })),
    ports: ["a", "b", "c"].map((id, i) => ({ portId: id, region1Id: "left", region2Id: "right", d: { x: 0, y: -0.025 + 0.025 * i, z: 0 } })), connections: [],
  }
  const tracker = createPhysicalCutTracker()
  const output = annotatePipeline9PhysicalCuts(graph, { minTraceWidth: 0.15, clearance: 0.1 }, tracker)
  expect(output.ports).toHaveLength(3)
  expect(output.ports.map((port) => [port.portId, port.d.x, port.d.y, port.d.z])).toEqual(graph.ports.map((port) => [port.portId, port.d.x, port.d.y, port.d.z]))
  expect(output.ports.every((port) => port.d.__pipeline9PhysicalCut.capacity === 1)).toBe(true)
  expect(graph.ports.some((port) => port.d.__pipeline9PhysicalCut)).toBe(false)
  const doubled = { ...output, ports: [...output.ports, { ...output.ports[0]!, portId: "duplicated", d: { ...output.ports[0]!.d, y: -0.0125 } }] }
  const reannotated = annotatePipeline9PhysicalCuts(doubled, { minTraceWidth: 0.15, clearance: 0.1 }, tracker)
  expect(reannotated.ports).toHaveLength(4)
  expect(reannotated.ports[3]!.d.__pipeline9PhysicalCut.capacity).toBe(1)
  const fixed = structuredClone(graph)
  fixed.ports[0]!.d._preloadedFixedNetIds = ["fixed"]
  expect(annotatePipeline9PhysicalCuts(fixed, { minTraceWidth: 0.15, clearance: 0.1 }, tracker).ports.some((port) => port.d.__pipeline9PhysicalCut)).toBe(false)
  const offEdge = structuredClone(graph)
  offEdge.ports[0]!.d.y = 1
  expect(annotatePipeline9PhysicalCuts(offEdge, { minTraceWidth: 0.15, clearance: 0.1 }, tracker).ports.some((port) => port.d.__pipeline9PhysicalCut)).toBe(false)
})
