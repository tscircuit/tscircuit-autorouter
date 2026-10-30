import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { partitionTinyHypergraph } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/partitionTinyHypergraph"

test("spatial partitions retain explicitly unrestricted regions", (): void => {
  const graph = {
    regions: [
      { regionId: "left", pointIds: [], d: { center: { x: -1, y: 0 }, netId: -1 } },
      { regionId: "right", pointIds: [], d: { center: { x: 1, y: 0 }, netId: 31 } },
    ],
    ports: [],
    connections: Array.from({ length: 32 }, (_, index) => ({
      connectionId: `route${index}`,
      mutuallyConnectedNetworkId: `net${index}`,
      startRegionId: index < 16 ? "left" : "right",
      endRegionId: index < 16 ? "left" : "right",
    })),
  } as SerializedHyperGraph
  const partitions = partitionTinyHypergraph(graph)
  const left = partitions.flatMap((partition) => partition.regions).find((region) => region.regionId === "left")
  const right = partitions.flatMap((partition) => partition.regions).find((region) => region.regionId === "right")
  expect(left?.d?.netId).toBe(-1)
  expect(right?.d?.netId).toBe(15)
})
