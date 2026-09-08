import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import { limitCrampedTinyGraphDuplicatePorts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/limitCrampedTinyGraphDuplicatePorts"

test("cramped duplicate admission uses original source metadata and retains false or absent flags", (): void => {
  const originalGraph: SerializedHyperGraph = {
    ports: [
      {
        portId: "cramped-source",
        region1Id: "left",
        region2Id: "right",
        d: { cramped: true },
      },
      {
        portId: "ordinary-source",
        region1Id: "left",
        region2Id: "right",
        d: { cramped: false },
      },
      {
        portId: "unspecified-source",
        region1Id: "left",
        region2Id: "right",
        d: {},
      },
    ],
    regions: [
      {
        regionId: "left",
        d: {},
        pointIds: ["cramped-source", "ordinary-source", "unspecified-source"],
      },
      {
        regionId: "right",
        d: {},
        pointIds: ["cramped-source", "ordinary-source", "unspecified-source"],
      },
    ],
  }
  const proposedGraph: SerializedHyperGraph = {
    ...originalGraph,
    ports: [
      ...originalGraph.ports,
      {
        portId: "reject-despite-clone-flag",
        region1Id: "left",
        region2Id: "right",
        d: { cramped: false, duplicatedFromPortId: "cramped-source" },
      },
      {
        portId: "keep-ordinary",
        region1Id: "left",
        region2Id: "right",
        d: { cramped: true, duplicatedFromPortId: "ordinary-source" },
      },
      {
        portId: "keep-unspecified",
        region1Id: "left",
        region2Id: "right",
        d: { cramped: true, duplicatedFromPortId: "unspecified-source" },
      },
    ],
    regions: originalGraph.regions.map(
      (region): SerializedHyperGraph["regions"][number] => ({
        ...region,
        pointIds: [
          ...region.pointIds,
          "reject-despite-clone-flag",
          "keep-ordinary",
          "keep-unspecified",
        ],
      }),
    ),
  }
  const result = limitCrampedTinyGraphDuplicatePorts({
    originalGraph,
    proposedGraph,
  })
  expect(result.removedPortIds).toEqual(["reject-despite-clone-flag"])
  expect(result.graph.ports).toEqual([
    ...originalGraph.ports,
    proposedGraph.ports[4],
    proposedGraph.ports[5],
  ])
  for (const region of result.graph.regions) {
    expect(region.pointIds).toEqual([
      "cramped-source",
      "ordinary-source",
      "unspecified-source",
      "keep-ordinary",
      "keep-unspecified",
    ])
  }
  const unchanged = limitCrampedTinyGraphDuplicatePorts({
    originalGraph,
    proposedGraph: result.graph,
  })
  expect(unchanged.graph).toBe(result.graph)
  expect(unchanged.removedPortIds).toEqual([])
})
