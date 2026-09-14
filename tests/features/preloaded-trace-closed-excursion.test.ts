import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { serializePreloadedTraceAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/serializePreloadedTraceAssignments"

test("closed preloaded excursions do not create zero-endpoint graph routes", () => {
  const assignment = (routePosition: number) => ({
    traceId: "fixed-trace",
    fixedNetId: "fixed-net",
    routePosition,
    tracePoint: { x: routePosition === 1 ? 1 : 0, y: 0 },
    z: 0,
  })
  const graph: SerializedHyperGraph = {
    regions: [
      { regionId: "west", pointIds: ["boundary"] },
      { regionId: "center", pointIds: ["boundary", "interior"] },
      { regionId: "east", pointIds: ["interior"] },
    ],
    ports: [
      {
        portId: "boundary",
        region1Id: "west",
        region2Id: "center",
        d: {
          _preloadedTracePortAssignments: [assignment(0), assignment(2)],
        },
      },
      {
        portId: "interior",
        region1Id: "center",
        region2Id: "east",
        d: { _preloadedTracePortAssignments: [assignment(1)] },
      },
    ],
    connections: [],
    solvedRoutes: [],
  }

  expect(serializePreloadedTraceAssignments(graph)).toEqual({
    preloadedTraceCount: 0,
    preloadedPortCount: 2,
    preloadedAssignmentCount: 0,
  })
  expect(graph.connections).toEqual([])
  expect(graph.solvedRoutes).toEqual([])
  expect(graph.regions.every((region) => !region.assignments?.length)).toBeTrue()
})
