import { expect, test } from "bun:test"
import { createPlanarSeedFixture, createPlanarSeedTestSolver, getPlanarSeedBoundaryPorts } from "../fixtures/tinyhypergraph-planar-seed"

test("same-net branches seed together using shared source strands or remain pending together when one branch is hot", (): void => {
  const cold = createPlanarSeedFixture()
  cold.graph.connections![1].mutuallyConnectedNetworkId = "upper-net"
  for (const segment of cold.segments) {
    if (segment.fromPortId === "boundary-top") segment.fromPortId = "boundary-bottom"
    if (segment.toPortId === "boundary-top") segment.toPortId = "boundary-bottom"
  }
  const coldSolver = createPlanarSeedTestSolver(cold.graph)
  coldSolver.initializePlanarSeed(cold.segments)
  expect(coldSolver.state.unroutedRoutes).toEqual([])
  expect(coldSolver.state.regionSegments.flat().filter(([routeId]) => routeId === 0)).toHaveLength(2)
  expect(coldSolver.state.regionSegments.flat().filter(([routeId]) => routeId === 1)).toHaveLength(2)
  expect(getPlanarSeedBoundaryPorts(coldSolver, 0)).toEqual(getPlanarSeedBoundaryPorts(coldSolver, 1))
  expect(getPlanarSeedBoundaryPorts(coldSolver, 0)).toHaveLength(1)
  const sharedPortId = getPlanarSeedBoundaryPorts(coldSolver, 0)[0]
  expect(coldSolver.problem.routeNet[0]).toBe(coldSolver.problem.routeNet[1])
  expect(coldSolver.state.portAssignment[sharedPortId]).toBe(coldSolver.problem.routeNet[0])
  const hot = createPlanarSeedFixture()
  hot.graph.connections![1].mutuallyConnectedNetworkId = "upper-net"
  for (const segment of hot.segments) {
    if (segment.connectionId !== "upper-route") continue
    if (segment.fromPortId === "boundary-bottom") segment.fromPortId = "boundary-other-layer"
    if (segment.toPortId === "boundary-bottom") segment.toPortId = "boundary-other-layer"
  }
  const hotSolver = createPlanarSeedTestSolver(hot.graph)
  const pendingBefore = [...hotSolver.state.unroutedRoutes]
  hotSolver.initializePlanarSeed(hot.segments)
  expect(hotSolver.state.unroutedRoutes).toEqual(pendingBefore)
  expect(hotSolver.state.regionSegments.every((segments) => segments.length === 0)).toBeTrue()
  expect(hotSolver.state.portAssignment.every((owner) => owner === -1)).toBeTrue()
})
