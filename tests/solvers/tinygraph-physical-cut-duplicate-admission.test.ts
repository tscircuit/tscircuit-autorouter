import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import { limitCrampedTinyGraphDuplicatePorts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/limitCrampedTinyGraphDuplicatePorts"

type SerializedPort = SerializedHyperGraph["ports"][number]
type SerializedRegion = SerializedHyperGraph["regions"][number]
type SerializedConnection = NonNullable<
  SerializedHyperGraph["connections"]
>[number]

test("finite cuts retain every original layer site and same-net identity without admitting copies", (): void => {
  const ports: SerializedPort[] = []
  for (const z of [0, 1]) {
    for (const y of [-0.25, 0.25]) {
      ports.push({
        portId: `finite-${z}-${y}`,
        region1Id: "left",
        region2Id: "right",
        d: {
          x: 0,
          y,
          z,
          cramped: z === 1 && y === 0.25,
          physicalCutId: "shared-cut",
          _preloadedFixedNetIds: ["shared-net"],
        },
      })
    }
  }
  for (const cramped of [false, undefined, true]) {
    ports.push({
      portId: `legacy-${cramped}`,
      region1Id: "left",
      region2Id: "right",
      d: { x: 0, y: 2, z: 0, cramped },
    })
  }
  const originalGraph: SerializedHyperGraph = {
    ports,
    regions: ["left", "right"].map(
      (regionId): SerializedRegion => ({
        regionId,
        pointIds: ports.map((port): string => port.portId),
        d: {},
        assignments: [
          {
            regionPort1Id: "finite-0--0.25",
            regionPort2Id: "finite-0-0.25",
            connectionId: "route-a",
          },
          {
            regionPort1Id: "finite-0--0.25",
            regionPort2Id: "finite-0-0.25",
            connectionId: "route-b",
          },
        ],
      }),
    ),
    connections: ["route-a", "route-b"].map(
      (connectionId): SerializedConnection => ({
        connectionId,
        mutuallyConnectedNetworkId: "shared-net",
        startRegionId: "left",
        endRegionId: "right",
      }),
    ),
    solvedRoutes: [],
  }
  const proposedGraph = structuredClone(originalGraph)
  for (const [index, port] of originalGraph.ports.entries()) {
    const duplicateId = `${port.portId}:copy`
    proposedGraph.ports.push({
      ...port,
      portId: duplicateId,
      d: {
        duplicatedFromPortId: port.portId,
        // Omission on half the proposed finite copies cannot erase provenance.
        ...(index % 2 === 0 && port.d?.physicalCutId !== undefined
          ? { physicalCutId: port.d.physicalCutId }
          : {}),
      },
    })
    for (const region of proposedGraph.regions) {
      region.pointIds.push(duplicateId)
    }
  }
  const originalBefore = structuredClone(originalGraph)
  const proposedBefore = structuredClone(proposedGraph)
  const result = limitCrampedTinyGraphDuplicatePorts({
    originalGraph,
    proposedGraph,
  })
  expect(result.removedPortIds).toEqual([
    "finite-0--0.25:copy",
    "finite-0-0.25:copy",
    "finite-1--0.25:copy",
    "finite-1-0.25:copy",
    "legacy-true:copy",
  ])
  expect(result.removedCrampedPortIds).toEqual([
    "finite-1-0.25:copy",
    "legacy-true:copy",
  ])
  expect(result.removedPhysicalCutPortIds).toEqual([
    "finite-0--0.25:copy",
    "finite-0-0.25:copy",
    "finite-1--0.25:copy",
    "finite-1-0.25:copy",
  ])
  const expectedPortIds = [
    ...originalGraph.ports.map((port): string => port.portId),
    "legacy-false:copy",
    "legacy-undefined:copy",
  ]
  expect(result.graph.ports.map((port): string => port.portId)).toEqual(
    expectedPortIds,
  )
  for (const [index, region] of result.graph.regions.entries()) {
    expect(region.pointIds).toEqual(expectedPortIds)
    expect(region.assignments).toBe(proposedGraph.regions[index]!.assignments)
  }
  for (const [index] of originalGraph.ports.entries()) {
    expect(result.graph.ports[index]).toBe(proposedGraph.ports[index])
  }
  expect(result.graph.connections).toBe(proposedGraph.connections)
  expect(result.graph.solvedRoutes).toBe(proposedGraph.solvedRoutes)
  expect(originalGraph).toEqual(originalBefore)
  expect(proposedGraph).toEqual(proposedBefore)
})
