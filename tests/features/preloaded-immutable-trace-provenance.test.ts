import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { hasPreloadedTraceSectionMetadata, serializePreloadedTraceAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/serializePreloadedTraceAssignments"

test("only explicit certified trace IDs remain immutable while prefix-like user copper keeps its normal reroutable sections", () => {
  const traces = ["actual-certified-copper", "pipeline9_forest_user_supplied"]
  const ports: SerializedHyperGraph["ports"] = traces.flatMap((traceId, z) => [0, 1].map((index) => ({
    portId: `${traceId}-${index}`, region1Id: index === 0 ? "west" : "center", region2Id: index === 0 ? "center" : "east",
    d: { x: index, y: 0, z, _preloadedTracePortAssignments: [{ traceId, fixedNetId: `net-${z}`, routePosition: index, tracePoint: { x: index, y: 0 }, z }] },
  })))
  const graph: SerializedHyperGraph = { ports, connections: [], solvedRoutes: [],
    regions: ["west", "center", "east"].map((regionId) => ({ regionId,
      pointIds: ports.filter((port) => port.region1Id === regionId || port.region2Id === regionId).map((port) => port.portId),
      d: { center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1] },
    })),
  }
  const originalPorts = structuredClone(ports)
  const stats = serializePreloadedTraceAssignments(graph, new Set([traces[0]!]))
  expect(stats).toEqual({ preloadedTraceCount: 1, preloadedPortCount: 4, preloadedAssignmentCount: 1 })
  expect(graph.connections).toHaveLength(1)
  const userSection = graph.connections![0]!
  if (!hasPreloadedTraceSectionMetadata(userSection)) throw new Error("User copper lost its reroutable section")
  expect(userSection.preloadedTraceSection.traceId).toBe(traces[1])
  expect(graph.ports).toEqual(originalPorts)
  expect(graph.regions).toHaveLength(3)
  expect(graph.regions.find((region) => region.regionId === "center")!.assignments).toHaveLength(1)
})
