import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { mergeSpatialWarmStart } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/mergeSpatialWarmStart"

test("spatial merge rejects whole conflicting routes and permits same-net port sharing", (): void => {
  const graph = {
    regions: [
      { regionId: "r0", pointIds: ["p0", "p1", "p3", "p4", "p5", "p6"], d: {} },
      { regionId: "r1", pointIds: ["p1", "p2"], d: {} },
    ],
    ports: [],
    connections: [
      { connectionId: "a", mutuallyConnectedNetworkId: "A", startRegionId: "r0", endRegionId: "r1" },
      { connectionId: "b", mutuallyConnectedNetworkId: "B", startRegionId: "r0", endRegionId: "r0" },
      { connectionId: "c", mutuallyConnectedNetworkId: "A", startRegionId: "r0", endRegionId: "r0" },
      { connectionId: "d", mutuallyConnectedNetworkId: "C", startRegionId: "r0", endRegionId: "r0" },
    ],
  } as SerializedHyperGraph
  const result = mergeSpatialWarmStart(graph, [
    { assignmentsByRegion: [
      { regionId: "r0", assignments: [{ connectionId: "a", regionPort1Id: "p0", regionPort2Id: "p1" }] },
      { regionId: "r1", assignments: [{ connectionId: "a", regionPort1Id: "p1", regionPort2Id: "p2" }] },
    ] },
    { assignmentsByRegion: [{ regionId: "r0", assignments: [
      { connectionId: "b", regionPort1Id: "p1", regionPort2Id: "p3" },
      { connectionId: "c", regionPort1Id: "p1", regionPort2Id: "p4" },
      { connectionId: "d", regionPort1Id: "p5", regionPort2Id: "p6" },
    ] }] },
  ])
  expect(result.acceptedRoutes).toBe(3)
  expect(result.rejectedRoutes).toBe(1)
  expect(result.assignmentsByRegion.get("r0")?.map((assignment) => assignment.connectionId)).toEqual(["a", "c", "d"])
  expect(result.assignmentsByRegion.get("r1")?.map((assignment) => assignment.connectionId)).toEqual(["a"])
})
