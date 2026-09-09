import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import { limitCrampedTinyGraphDuplicatePorts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/limitCrampedTinyGraphDuplicatePorts"

type SerializedCandidate = NonNullable<
  SerializedHyperGraph["solvedRoutes"]
>[number]["path"][number]

test("cramped admission leaves input graphs and seeded copper identities unchanged", (): void => {
  const connection = {
    connectionId: "seeded-route",
    mutuallyConnectedNetworkId: "fixed-net",
    startRegionId: "left",
    endRegionId: "right",
  }
  const originalGraph: SerializedHyperGraph = {
    ports: [
      {
        portId: "seed-in",
        region1Id: "left",
        region2Id: "center",
        d: {
          x: -1,
          y: 0,
          z: 0,
          cramped: true,
          _preloadedFixedNetIds: ["fixed-net"],
          _preloadedTracePortAssignments: [
            {
              traceId: "unchanged-copper",
              fixedNetId: "fixed-net",
              routePosition: 0,
              tracePoint: { x: -1, y: 0.02 },
              z: 0,
            },
          ],
        },
      },
      {
        portId: "seed-out",
        region1Id: "center",
        region2Id: "right",
        d: {
          x: 1,
          y: 0,
          z: 0,
          cramped: false,
          _preloadedFixedNetIds: ["fixed-net"],
          _preloadedTracePortAssignments: [
            {
              traceId: "unchanged-copper",
              fixedNetId: "fixed-net",
              routePosition: 1,
              tracePoint: { x: 1, y: 0.02 },
              z: 0,
            },
          ],
        },
      },
    ],
    regions: [
      { regionId: "left", pointIds: ["seed-in"], d: {} },
      {
        regionId: "center",
        d: {},
        pointIds: ["seed-in", "seed-out"],
        assignments: [
          {
            regionPort1Id: "seed-in",
            regionPort2Id: "seed-out",
            connectionId: "seeded-route",
          },
        ],
      },
      { regionId: "right", pointIds: ["seed-out"], d: {} },
    ],
    connections: [connection],
    solvedRoutes: [
      {
        connection,
        requiredRip: false,
        path: ["seed-in", "seed-out"].map(
          (portId): SerializedCandidate => ({
            portId,
            g: 0,
            h: 0,
            f: 0,
            hops: 0,
            ripRequired: false,
          }),
        ),
      },
    ],
  }
  const proposedGraph = structuredClone(originalGraph)
  proposedGraph.ports.push(
    {
      ...proposedGraph.ports[0]!,
      portId: "rejected-seeded-expansion",
      d: {
        ...structuredClone(proposedGraph.ports[0]!.d),
        duplicatedFromPortId: "seed-in",
      },
    },
    {
      ...proposedGraph.ports[1]!,
      portId: "admitted-ordinary-expansion",
      d: {
        ...structuredClone(proposedGraph.ports[1]!.d),
        duplicatedFromPortId: "seed-out",
      },
    },
  )
  proposedGraph.regions[0]!.pointIds.push("rejected-seeded-expansion")
  proposedGraph.regions[1]!.pointIds.push(
    "rejected-seeded-expansion",
    "admitted-ordinary-expansion",
  )
  proposedGraph.regions[2]!.pointIds.push("admitted-ordinary-expansion")
  const originalBefore = structuredClone(originalGraph)
  const proposedBefore = structuredClone(proposedGraph)
  const result = limitCrampedTinyGraphDuplicatePorts({
    originalGraph,
    proposedGraph,
  })
  expect(result.removedPortIds).toEqual(["rejected-seeded-expansion"])
  expect(originalGraph).toEqual(originalBefore)
  expect(proposedGraph).toEqual(proposedBefore)
  expect(result.graph.ports).toEqual([
    proposedGraph.ports[0],
    proposedGraph.ports[1],
    proposedGraph.ports[3],
  ])
  expect(result.graph.ports[0]).toBe(proposedGraph.ports[0])
  expect(result.graph.ports[1]).toBe(proposedGraph.ports[1])
  expect(result.graph.ports[2]).toBe(proposedGraph.ports[3])
  expect(result.graph.connections).toBe(proposedGraph.connections)
  expect(result.graph.solvedRoutes).toBe(proposedGraph.solvedRoutes)
  expect(result.graph.regions[1]!.assignments).toBe(
    proposedGraph.regions[1]!.assignments,
  )
  expect(result.graph.regions[0]!.pointIds).toEqual(["seed-in"])
  expect(result.graph.regions[1]!.pointIds).toEqual([
    "seed-in",
    "seed-out",
    "admitted-ordinary-expansion",
  ])
  expect(result.graph.regions[2]!.pointIds).toEqual([
    "seed-out",
    "admitted-ordinary-expansion",
  ])
})
