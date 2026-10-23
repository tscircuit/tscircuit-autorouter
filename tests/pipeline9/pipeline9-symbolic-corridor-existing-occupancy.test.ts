import { expect, test } from "bun:test"
import { compileSymbolicCorridors } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/compileSymbolicCorridors"
import { createSymbolicCorridorGraph } from "../fixtures/createSymbolicCorridorGraph"

test("compiler explicitly excludes fixed-net, trace-section, and region-only existing occupancy", () => {
  const fixed = createSymbolicCorridorGraph()
  fixed.ports[0]!.d._preloadedFixedNetIds = ["fixed"]
  expect(compileSymbolicCorridors(fixed).stats.symbolicCorridorUnsupportedPreloads).toBe(1)
  const section = createSymbolicCorridorGraph()
  Object.assign(section.connections![0]!, { preloadedTraceSection: { traceId: "preloaded", startRoutePosition: 0, endRoutePosition: 1, startPoint: { x: -4, y: 0.5, z: 0 }, endPoint: { x: 4, y: 0.5, z: 0 } } })
  const sectionResult = compileSymbolicCorridors(section)
  expect(sectionResult.applicable).toBe(false)
  expect(sectionResult.stats.symbolicCorridorUnsupportedPreloads).toBe(1)
  const assigned = createSymbolicCorridorGraph()
  assigned.regions[1]!.assignments = [{ connectionId: "A", regionPort1Id: "e0p0", regionPort2Id: "e1p0" }]
  const assignedResult = compileSymbolicCorridors(assigned)
  expect(assignedResult.applicable).toBe(false)
  expect(assignedResult.stats.symbolicCorridorUnsupportedAssignments).toBe(1)
})
