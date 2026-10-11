import { expect, test } from "bun:test"
import { createPlanarSeedFixture, createPlanarSeedTestSolver } from "../fixtures/tinyhypergraph-planar-seed"

test("planar initialization preserves exact preloaded copper and restores only real assignments on rerip", (): void => {
  const { graph, segments } = createPlanarSeedFixture()
  graph.regions.find(({ regionId }) => regionId === "left")!.assignments = [{ connectionId: "upper-route", regionPort1Id: "upper-in", regionPort2Id: "boundary-top" }]
  graph.regions.find(({ regionId }) => regionId === "right")!.assignments = [{ connectionId: "upper-route", regionPort1Id: "boundary-top", regionPort2Id: "upper-out" }]
  const solver = createPlanarSeedTestSolver(graph)
  const realAssignments = solver.problem.initialAssignments
  const realSegments = structuredClone(solver.state.regionSegments)
  const realOwners = new Int32Array(solver.state.portAssignment)
  const realPending = [...solver.state.unroutedRoutes]
  solver.initializePlanarSeed(segments)

  expect(solver.problem.initialAssignments).toBe(realAssignments)
  expect(solver.state.unroutedRoutes).toEqual([])
  for (let regionId = 0; regionId < solver.topology.regionCount; regionId++) {
    expect(solver.state.regionSegments[regionId].filter(([routeId]) => routeId === 0)).toEqual(realSegments[regionId])
  }
  for (let portId = 0; portId < realOwners.length; portId++) {
    if (realOwners[portId] !== -1) expect(solver.state.portAssignment[portId]).toBe(realOwners[portId])
  }
  solver.resetRoutingStateForRerip()
  expect(solver.state.regionSegments).toEqual(realSegments)
  expect(solver.state.portAssignment).toEqual(realOwners)
  expect(solver.state.unroutedRoutes).toEqual(realPending)
  expect(solver.problem.initialAssignments).toBe(realAssignments)
})
