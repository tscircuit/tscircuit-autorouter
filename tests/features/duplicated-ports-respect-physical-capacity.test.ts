import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { fitDuplicatedPortsToPhysicalSlots } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/fitDuplicatedPortsToPhysicalSlots"

test("congestion cannot duplicate a narrow physical routing slot", () => {
  for (const width of [0.14120241, 2]) {
    const graph: SerializedHyperGraph = {
      regions: [
        {
          regionId: "north",
          pointIds: ["original", "dup1", "dup2", "dup3"],
          d: { center: { x: 0, y: 0.5 }, width, height: 1 },
        },
        {
          regionId: "south",
          pointIds: ["original", "dup1", "dup2", "dup3"],
          d: { center: { x: 0, y: -0.5 }, width, height: 1 },
        },
      ],
      ports: [
        {
          portId: "original",
          region1Id: "north",
          region2Id: "south",
          d: { x: 0, y: 0, z: 0 },
        },
        ...[1, 2, 3].map((index) => ({
          portId: `dup${index}`,
          region1Id: "north",
          region2Id: "south",
          d: { x: index * 0.01, y: 0, z: 0, duplicatedFromPortId: "original" },
        })),
      ],
    }
    const spacing = 0.1524 + 0.1
    const result = fitDuplicatedPortsToPhysicalSlots(graph, spacing)
    expect(result.ports[0]!.d).toEqual(graph.ports[0]!.d)
    expect(result.ports).toHaveLength(width < spacing ? 1 : 4)
    expect(
      result.regions.every(
        (region) => region.pointIds.length === result.ports.length,
      ),
    ).toBeTrue()
    for (let i = 0; i < result.ports.length; i++) {
      for (let j = i + 1; j < result.ports.length; j++) {
        const a = result.ports[i]!.d
        const b = result.ports[j]!.d
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(
          spacing - 1e-6,
        )
      }
    }
  }
})
