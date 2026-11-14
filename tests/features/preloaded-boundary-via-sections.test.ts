import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  hasPreloadedTraceSectionMetadata,
  serializePreloadedTraceAssignments,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/serializePreloadedTraceAssignments"

const createBoundaryViaGraph = (): SerializedHyperGraph => ({
  regions: [
    { regionId: "west", x: -1, y: 0.5, pointIds: ["before"] },
    { regionId: "inner", x: 0, y: -0.5, pointIds: ["inner"] },
    { regionId: "top", x: 0, y: -0.5, pointIds: ["top"] },
    { regionId: "east", x: 1, y: 0.5, pointIds: ["after"] },
    {
      regionId: "shared",
      x: 0,
      y: 0.5,
      pointIds: ["before", "inner", "top", "after"],
    },
  ].map((region) => ({
    regionId: region.regionId,
    pointIds: region.pointIds,
    d: {
      center: { x: region.x, y: region.y },
      width: 1,
      height: 1,
    },
  })),
  ports: [
    { id: "before", neighbor: "west", x: -0.5, y: 0.5, z: 1, copperY: 0.5 },
    { id: "inner", neighbor: "inner", x: 0, y: 0, z: 1, copperY: -0.01 },
    { id: "top", neighbor: "top", x: 0, y: 0, z: 0, copperY: -0.01 },
    { id: "after", neighbor: "east", x: 0.5, y: 0.5, z: 0, copperY: 0.5 },
  ].map((port, routePosition) => ({
    portId: port.id,
    region1Id: port.neighbor,
    region2Id: "shared",
    d: {
      x: port.x,
      y: port.y,
      z: port.z,
      _preloadedTracePortAssignments: [
        {
          traceId: "ddr",
          fixedNetId: "ddr-net",
          routePosition,
          tracePoint: { x: port.x, y: port.copperY },
          z: port.z,
        },
      ],
    },
  })),
  connections: [],
  solvedRoutes: [],
})

test("a boundary via stays fixed while its neighboring wire sections can reroute", (): void => {
  const graph = createBoundaryViaGraph()
  const stats = serializePreloadedTraceAssignments(graph)
  expect(stats.preloadedAssignmentCount).toBe(3)
  expect(
    graph.regions.find((region) => region.regionId === "shared")!.assignments,
  ).toHaveLength(3)
  const sections = graph.connections!.map((connection) => {
    if (!hasPreloadedTraceSectionMetadata(connection))
      throw new Error("Missing preloaded section")
    return {
      isFixed: connection.isFixed === true,
      start: connection.preloadedTraceSection.startRoutePosition,
      end: connection.preloadedTraceSection.endRoutePosition,
    }
  })
  expect(sections).toEqual([
    { isFixed: false, start: 0, end: 1 },
    { isFixed: true, start: 1, end: 2 },
    { isFixed: false, start: 2, end: 3 },
  ])

  const contained = createBoundaryViaGraph()
  for (const port of contained.ports) {
    for (const assignment of port.d._preloadedTracePortAssignments) {
      assignment.tracePoint.y = Math.abs(assignment.tracePoint.y)
    }
  }
  serializePreloadedTraceAssignments(contained)
  expect(contained.connections).toHaveLength(1)
  expect(contained.connections![0]).not.toHaveProperty("isFixed")

  const locked = createBoundaryViaGraph()
  locked.ports[0]!.d._preloadedTracePortAssignments[0].isFixed = true
  serializePreloadedTraceAssignments(locked)
  expect(locked.connections).toHaveLength(1)
  expect(locked.connections![0]).toHaveProperty("isFixed", true)
})
