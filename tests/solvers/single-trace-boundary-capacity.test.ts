import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { CapacityMeshNode } from "lib/types"
import { limitDuplicatePortsToRoutingCapacity } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/limitDuplicatePortsToRoutingCapacity"

test("single-trace boundaries reject synthetic capacity while preserving original ports and wider choices", () => {
  const nodes: CapacityMeshNode[] = []
  const graph: SerializedHyperGraph = { regions: [], ports: [] }
  for (const [index, length] of [0.15, 0.2, 1].entries()) {
    const horizontal = index === 0
    for (const side of [0, 1]) {
      const regionId = `node_${index}_${side}`
      nodes.push({
        capacityMeshNodeId: regionId,
        center: { x: horizontal ? 0 : side, y: horizontal ? side : 0 },
        width: horizontal ? length : 1,
        height: horizontal ? 1 : length,
        layer: "bottom",
        availableZ: [1],
      })
      graph.regions.push({
        regionId,
        pointIds: [`port_${index}`, `duplicate_${index}`],
        d: {},
      })
    }
    const original: SerializedHyperGraph["ports"][number] = {
      portId: `port_${index}`,
      region1Id: `node_${index}_0`,
      region2Id: `node_${index}_1`,
      d: {
        x: horizontal ? 0 : 0.5,
        y: horizontal ? 0.5 : 0,
        z: 1,
        _preloadedFixedNetIds: ["fixed_net"],
      },
    }
    graph.ports.push(original, {
      ...original,
      portId: `duplicate_${index}`,
      d: { ...original.d, duplicatedFromPortId: original.portId },
    })
  }
  const before = structuredClone(graph)
  const constrained = limitDuplicatePortsToRoutingCapacity({
    graph,
    nodes,
    routingGeometry: {
      obstacles: [],
      layerCount: 2,
      traceWidth: 0.1,
      traceClearance: 0.1,
    },
  })
  expect(constrained.ports.map((port) => port.portId)).toEqual([
    "port_0",
    "port_1",
    "duplicate_1",
    "port_2",
    "duplicate_2",
  ])
  expect(
    constrained.regions.slice(0, 2).map((region) => region.pointIds),
  ).toEqual([["port_0"], ["port_0"]])
  expect(constrained.regions.slice(2)).toEqual(before.regions.slice(2))
  expect(constrained.ports).toEqual(
    before.ports.filter((port) => port.portId !== "duplicate_0"),
  )
  expect(graph).toEqual(before)
})
