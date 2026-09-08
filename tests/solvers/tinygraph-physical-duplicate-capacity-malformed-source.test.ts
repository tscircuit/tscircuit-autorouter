import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import { limitCrampedTinyGraphDuplicatePorts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/limitCrampedTinyGraphDuplicatePorts"

test("cramped admission fails loudly on malformed new provenance or missing original ports", (): void => {
  const originalGraph: SerializedHyperGraph = {
    ports: [
      {
        portId: "source",
        region1Id: "left",
        region2Id: "right",
        d: { cramped: true },
      },
    ],
    regions: [
      { regionId: "left", pointIds: ["source"] },
      { regionId: "right", pointIds: ["source"] },
    ],
  }
  for (const duplicatedFromPortId of [undefined, null, 7, "", "missing"]) {
    const proposedGraph: SerializedHyperGraph = {
      ...originalGraph,
      ports: [
        ...originalGraph.ports,
        {
          portId: "invalid-candidate",
          region1Id: "left",
          region2Id: "right",
          d: { duplicatedFromPortId },
        },
      ],
    }
    const proposedBefore = structuredClone(proposedGraph)
    expect((): void => {
      limitCrampedTinyGraphDuplicatePorts({ originalGraph, proposedGraph })
    }).toThrow(
      'limitCrampedTinyGraphDuplicatePorts: new port "invalid-candidate"',
    )
    expect(proposedGraph).toEqual(proposedBefore)
  }
  const chainedProposal: SerializedHyperGraph = {
    ...originalGraph,
    ports: [
      ...originalGraph.ports,
      {
        portId: "new-parent",
        region1Id: "left",
        region2Id: "right",
        d: { duplicatedFromPortId: "source" },
      },
      {
        portId: "new-child",
        region1Id: "left",
        region2Id: "right",
        d: { duplicatedFromPortId: "new-parent" },
      },
    ],
  }
  expect((): void => {
    limitCrampedTinyGraphDuplicatePorts({
      originalGraph,
      proposedGraph: chainedProposal,
    })
  }).toThrow('references unknown original source "new-parent"')
  expect((): void => {
    limitCrampedTinyGraphDuplicatePorts({
      originalGraph,
      proposedGraph: { ...originalGraph, ports: [] },
    })
  }).toThrow('proposal is missing original port "source"')
  expect(originalGraph.ports).toHaveLength(1)
  expect(originalGraph.regions[0]!.pointIds).toEqual(["source"])
  expect(originalGraph.regions[1]!.pointIds).toEqual(["source"])
})
