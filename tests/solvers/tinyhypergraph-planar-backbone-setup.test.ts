import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  loadSerializedHyperGraph,
  type TinyHyperGraphSolverOptions,
} from "tiny-hypergraph/lib/index"
import type { IndependentRouteSegment } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/DuplicateCongestedPortSolverWithIndependentRoutes"
import { initializePlanarBoundarySeed } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/initializePlanarBoundarySeed"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"

class SetupTestSolver extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  readonly routeSuccessCountsForTest = this.routeSuccessCountByRouteId
}

test("queued planar paths initialize after successful static precheck and preserve ordinary precheck failure", (): void => {
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "start",
        pointIds: ["start-port"],
        d: { center: { x: -3, y: 0 }, width: 2, height: 2, availableZ: [0, 1] },
      },
      {
        regionId: "left",
        pointIds: ["start-port", "boundary-port"],
        d: { center: { x: -1, y: 0 }, width: 2, height: 2, availableZ: [0, 1] },
      },
      {
        regionId: "right",
        pointIds: ["boundary-port", "end-port"],
        d: { center: { x: 1, y: 0 }, width: 2, height: 2, availableZ: [0, 1] },
      },
      {
        regionId: "end",
        pointIds: ["end-port"],
        d: { center: { x: 3, y: 0 }, width: 2, height: 2, availableZ: [0, 1] },
      },
    ],
    ports: [
      {
        portId: "start-port",
        region1Id: "start",
        region2Id: "left",
        d: { x: -2, y: 0, z: 0 },
      },
      {
        portId: "boundary-port",
        region1Id: "left",
        region2Id: "right",
        d: { x: 0, y: 0, z: 0 },
      },
      {
        portId: "end-port",
        region1Id: "right",
        region2Id: "end",
        d: { x: 2, y: 0, z: 0 },
      },
    ],
    connections: [{
      connectionId: "route",
      startRegionId: "start",
      endRegionId: "end",
      mutuallyConnectedNetworkId: "net",
    }],
  }
  const segments: IndependentRouteSegment[] = [
    { connectionId: "route", regionId: "left", fromPortId: "start-port", toPortId: "boundary-port" },
    { connectionId: "route", regionId: "right", fromPortId: "boundary-port", toPortId: "end-port" },
  ]
  const options: TinyHyperGraphSolverOptions = {
    STATIC_REACHABILITY_PRECHECK: true,
    PARTIAL_RIP_ENABLED: true,
    PARTIAL_RIP_MIN_ROUTE_COUNT: 0,
    PARTIAL_RIP_MAX_ROUTE_COUNT: Number.POSITIVE_INFINITY,
  }
  const createSolver = (input: SerializedHyperGraph): SetupTestSolver => {
    const { topology, problem } = loadSerializedHyperGraph(structuredClone(input))
    return new SetupTestSolver(topology, problem, options)
  }
  const queued = createSolver(graph)
  const expected = createSolver(graph)
  const originalAssignments = queued.problem.initialAssignments
  const originalState = structuredClone(queued.state.regionIntersectionCaches)
  queued.setInitialBackboneSegments(segments)
  expect(queued.state.regionSegments.flat()).toHaveLength(0)
  expect(queued.state.regionIntersectionCaches).toEqual(originalState)
  expect([...queued.routeSuccessCountsForTest]).toEqual([0])
  expect(queued.stats.initialColdSeedRouteCount).toBeUndefined()

  expected._setup()
  initializePlanarBoundarySeed(expected, segments, expected.routeSuccessCountsForTest)
  queued._setup()
  expect(queued.failed).toBeFalse()
  expect(queued.state.regionSegments).toEqual(expected.state.regionSegments)
  expect(queued.state.regionIntersectionCaches).toEqual(expected.state.regionIntersectionCaches)
  expect(queued.state.portAssignment).toEqual(expected.state.portAssignment)
  expect(queued.state.unroutedRoutes).toEqual([])
  expect([...queued.routeSuccessCountsForTest]).toEqual([1])
  expect(queued.problem.initialAssignments).toBe(originalAssignments)
  expect(queued.stats).toMatchObject({
    initialColdSeedRouteCount: 1,
    initialColdSeedNetCount: 1,
    initialColdSeedAssignmentCount: 2,
    initialColdSeedPendingRouteCount: 0,
    initialColdSeedEstimatedVias: 0,
  })
  const seededState = structuredClone(queued.state.regionSegments)
  const seedElapsedMs = queued.stats.initialColdSeedElapsedMs
  queued._setup()
  expect(queued.state.regionSegments).toEqual(seededState)
  expect([...queued.routeSuccessCountsForTest]).toEqual([1])
  expect(queued.stats.initialColdSeedElapsedMs).toBe(seedElapsedMs)
  expect((): void => queued.setInitialBackboneSegments(segments)).toThrow("before setup")

  const disconnected = structuredClone(graph)
  disconnected.ports = disconnected.ports.filter(({ portId }): boolean => portId !== "boundary-port")
  for (const region of disconnected.regions) {
    region.pointIds = region.pointIds.filter((portId): boolean => portId !== "boundary-port")
  }
  const failedBaseline = createSolver(disconnected)
  const failedQueued = createSolver(disconnected)
  // The missing boundary would throw inside the initializer. Static precheck
  // must report its ordinary failure first and leave these paths unapplied.
  failedQueued.setInitialBackboneSegments(segments)
  expect((): void => failedBaseline._setup()).not.toThrow()
  expect((): void => failedQueued._setup()).not.toThrow()
  expect(failedBaseline.failed).toBeTrue()
  expect(failedQueued.failed).toBeTrue()
  expect(failedQueued.error).toBe(failedBaseline.error)
  expect(failedQueued.error).toContain("Static reachability precheck failed")
  expect(failedQueued.state.regionSegments).toEqual(failedBaseline.state.regionSegments)
  expect(failedQueued.state.regionIntersectionCaches).toEqual(failedBaseline.state.regionIntersectionCaches)
  expect(failedQueued.state.portAssignment).toEqual(failedBaseline.state.portAssignment)
  expect(failedQueued.state.unroutedRoutes).toEqual(failedBaseline.state.unroutedRoutes)
  expect(failedQueued.routeSuccessCountsForTest).toEqual(failedBaseline.routeSuccessCountsForTest)
  expect(failedQueued.stats).toEqual(failedBaseline.stats)
  expect(failedQueued.stats.initialColdSeedRouteCount).toBeUndefined()
})
