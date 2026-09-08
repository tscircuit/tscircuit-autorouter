import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import { limitCrampedTinyGraphDuplicatePorts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/limitCrampedTinyGraphDuplicatePorts"

test("cramped admission preserves every original port and removes both duplicate incidences", (): void => {
  const originalGraph: SerializedHyperGraph = {
    ports: [
      {
        portId: "first-original",
        region1Id: "left",
        region2Id: "right",
        d: { x: 0, y: -1, z: 0, cramped: true },
      },
      {
        portId: "second-original",
        region1Id: "left",
        region2Id: "right",
        d: { x: 0, y: 1, z: 0, cramped: true },
      },
      {
        portId: "original-with-prior-provenance",
        region1Id: "left",
        region2Id: "right",
        d: {
          x: 0,
          y: 0,
          z: 1,
          cramped: true,
          duplicatedFromPortId: "earlier-producer-source",
        },
      },
    ],
    regions: [
      {
        regionId: "left",
        pointIds: [
          "first-original",
          "second-original",
          "original-with-prior-provenance",
        ],
      },
      {
        regionId: "right",
        pointIds: [
          "original-with-prior-provenance",
          "second-original",
          "first-original",
        ],
      },
    ],
  }
  const proposedGraph: SerializedHyperGraph = {
    ...originalGraph,
    ports: [
      ...originalGraph.ports,
      {
        portId: "candidate-a",
        region1Id: "left",
        region2Id: "right",
        d: { duplicatedFromPortId: "first-original" },
      },
      {
        portId: "candidate-b",
        region1Id: "left",
        region2Id: "right",
        d: { duplicatedFromPortId: "second-original" },
      },
    ],
    regions: [
      {
        ...originalGraph.regions[0]!,
        pointIds: [
          "first-original",
          "candidate-a",
          "second-original",
          "candidate-b",
          "original-with-prior-provenance",
        ],
      },
      {
        ...originalGraph.regions[1]!,
        pointIds: [
          "candidate-b",
          ...originalGraph.regions[1]!.pointIds,
          "candidate-a",
        ],
      },
    ],
  }
  const result = limitCrampedTinyGraphDuplicatePorts({
    originalGraph,
    proposedGraph,
  })
  expect(result.removedPortIds).toEqual(["candidate-a", "candidate-b"])
  expect(result.graph.ports).toEqual(originalGraph.ports)
  expect(result.graph.regions).toEqual(originalGraph.regions)
  for (const [index, port] of originalGraph.ports.entries()) {
    expect(result.graph.ports[index]).toBe(port)
  }
  expect(proposedGraph.ports).toHaveLength(5)
  expect(proposedGraph.regions[0]!.pointIds).toHaveLength(5)
  expect(proposedGraph.regions[1]!.pointIds).toHaveLength(5)
})
