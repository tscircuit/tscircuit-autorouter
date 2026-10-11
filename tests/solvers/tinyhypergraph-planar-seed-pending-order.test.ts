import { expect, test } from "bun:test"
import {
  createPlanarSeedFixture,
  createPlanarSeedTestSolver,
} from "../fixtures/tinyhypergraph-planar-seed"

test("planar seeding preserves upstream order for the routes left pending", (): void => {
  const { graph, segments } = createPlanarSeedFixture()
  graph.regions.push(
    { regionId: "middle-start", pointIds: ["middle-in"], d: { center: { x: -2.2, y: 0 }, width: 0.4, height: 0.4, availableZ: [0, 1] } },
    { regionId: "middle-end", pointIds: ["middle-out"], d: { center: { x: 2.2, y: 0 }, width: 0.4, height: 0.4, availableZ: [0, 1] } },
  )
  graph.regions.find(({ regionId }) => regionId === "left")!.pointIds.push("middle-in")
  graph.regions.find(({ regionId }) => regionId === "right")!.pointIds.push("middle-out")
  graph.ports.push(
    { portId: "middle-in", region1Id: "middle-start", region2Id: "left", d: { x: -2, y: 0, z: 0 } },
    { portId: "middle-out", region1Id: "right", region2Id: "middle-end", d: { x: 2, y: 0, z: 0 } },
  )
  graph.connections!.push({ connectionId: "middle-route", startRegionId: "middle-start", endRegionId: "middle-end", mutuallyConnectedNetworkId: "middle-net" })
  for (const segment of segments) {
    if (segment.connectionId !== "upper-route") continue
    if (segment.fromPortId === "boundary-bottom") segment.fromPortId = "boundary-other-layer"
    if (segment.toPortId === "boundary-bottom") segment.toPortId = "boundary-other-layer"
  }
  segments.push(
    { connectionId: "middle-route", regionId: "left", fromPortId: "middle-in", toPortId: "boundary-other-layer" },
    { connectionId: "middle-route", regionId: "right", fromPortId: "boundary-other-layer", toPortId: "middle-out" },
  )
  const solver = createPlanarSeedTestSolver(graph)
  solver.RIP_THRESHOLD_START = 0.8
  solver.state.unroutedRoutes = [2, 1, 0]
  const startPorts = new Int32Array(solver.problem.routeStartPort)
  const endPorts = new Int32Array(solver.problem.routeEndPort)
  const stats = solver.initializePlanarSeed(segments)

  expect(stats.initialColdSeedRouteCount).toBe(1)
  expect(stats.initialColdSeedNetCount).toBe(1)
  expect(stats.initialColdSeedPendingRouteCount).toBe(2)
  expect(solver.state.unroutedRoutes).toEqual([2, 0])
  expect(solver.state.regionSegments.flat().map(([routeId]) => routeId)).toEqual([1, 1])
  expect(solver.routeSuccessCountsForTest).toEqual(new Uint32Array([0, 1, 0]))
  expect(solver.problem.routeStartPort).toEqual(startPorts)
  expect(solver.problem.routeEndPort).toEqual(endPorts)
  expect(solver.solved).toBeFalse()
  expect(solver.iterations).toBe(0)
})
