import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import { limitCrampedTinyGraphDuplicatePorts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/limitCrampedTinyGraphDuplicatePorts"

test("finite-cut admission rejects malformed explicit identities and changed original provenance", (): void => {
  const originalGraph: SerializedHyperGraph = {
    ports: [
      {
        portId: "original-site",
        region1Id: "left",
        region2Id: "right",
        d: { x: 0, y: 0, z: 0, physicalCutId: "cut-a" },
      },
    ],
    regions: [
      { regionId: "left", pointIds: ["original-site"], d: {} },
      { regionId: "right", pointIds: ["original-site"], d: {} },
    ],
  }
  for (const physicalCutId of [null, 0, false, "", "  ", {}, []]) {
    const malformedOriginal = structuredClone(originalGraph)
    malformedOriginal.ports[0]!.d = { physicalCutId }
    expect((): void => {
      limitCrampedTinyGraphDuplicatePorts({
        originalGraph: malformedOriginal,
        proposedGraph: originalGraph,
      })
    }).toThrow('Invalid physicalCutId for port "original-site"')

    const proposedGraph = structuredClone(originalGraph)
    proposedGraph.ports.push({
      portId: "proposed-copy",
      region1Id: "left",
      region2Id: "right",
      d: { duplicatedFromPortId: "original-site", physicalCutId },
    })
    expect((): void => {
      limitCrampedTinyGraphDuplicatePorts({ originalGraph, proposedGraph })
    }).toThrow('Invalid physicalCutId for port "proposed-copy"')
  }
  for (const physicalCutId of [undefined, "different-cut"]) {
    const proposedGraph = structuredClone(originalGraph)
    proposedGraph.ports[0]!.d = { x: 0, y: 0, z: 0, physicalCutId }
    expect((): void => {
      limitCrampedTinyGraphDuplicatePorts({ originalGraph, proposedGraph })
    }).toThrow(
      'proposal changed physicalCutId of original port "original-site"',
    )
  }
  const proposedGraph = structuredClone(originalGraph)
  const result = limitCrampedTinyGraphDuplicatePorts({
    originalGraph,
    proposedGraph,
  })
  expect(result.graph).toBe(proposedGraph)
  expect(result.removedPortIds).toEqual([])
  expect(originalGraph.ports[0]!.d?.physicalCutId).toBe("cut-a")
})
