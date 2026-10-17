import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  loadSerializedHyperGraph,
  SelectiveReripTinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
} from "tiny-hypergraph/lib/index"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { createDetourFixture } from "../fixtures/tinyhypergraphLandmarkHeuristicFixture"

class NativeSetupTestSolver extends SelectiveReripTinyHyperGraphSolver {
  readonly routeSuccessCountsForTest = this.routeSuccessCountByRouteId
}

class PreparedSetupTestSolver extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  readonly routeSuccessCountsForTest = this.routeSuccessCountByRouteId
}

const createSetupSolvers = (
  graph: SerializedHyperGraph,
  outsideIn: boolean,
): { baseline: NativeSetupTestSolver; candidate: PreparedSetupTestSolver } => {
  const options: TinyHyperGraphSolverOptions = {
    STATIC_REACHABILITY_PRECHECK: true,
    PARTIAL_RIP_ENABLED: true,
    PARTIAL_RIP_MIN_ROUTE_COUNT: 0,
    PARTIAL_RIP_MAX_ROUTE_COUNT: Number.POSITIVE_INFINITY,
    OUTSIDE_IN_ROUTING: outsideIn,
    TRACE_DENSITY_COST_FACTOR: 0.7,
  }
  const baselineInput = loadSerializedHyperGraph(structuredClone(graph))
  const candidateInput = loadSerializedHyperGraph(structuredClone(graph))
  return {
    baseline: new NativeSetupTestSolver(
      baselineInput.topology,
      baselineInput.problem,
      options,
    ),
    candidate: new PreparedSetupTestSolver(
      candidateInput.topology,
      candidateInput.problem,
      options,
    ),
  }
}

const snapshotActualState = (
  solver: NativeSetupTestSolver | PreparedSetupTestSolver,
): string => {
  return JSON.stringify({
    owners: [...solver.state.portAssignment],
    segments: solver.state.regionSegments,
    caches: solver.state.regionIntersectionCaches,
    pending: solver.state.unroutedRoutes,
    history: [...solver.state.regionCongestionCost],
    counters: [...solver.routeSuccessCountsForTest],
    currentRouteId: solver.state.currentRouteId,
    currentRouteNetId: solver.state.currentRouteNetId,
    goalPortId: solver.state.goalPortId,
    ripCount: solver.state.ripCount,
    initialAssignments: solver.problem.initialAssignments,
  })
}

test("landmark setup includes successful one-sided routing and excludes outside-in and failed static reachability", (): void => {
  const graph = createDetourFixture()
  graph.connections!.push({
    connectionId: "preloaded-island",
    startRegionId: "island-a",
    endRegionId: "island-b",
    mutuallyConnectedNetworkId: "preloaded-island-net",
  })
  const island = graph.regions.find((region) => region.regionId === "island")
  if (!island) throw new Error("Fixture island region is missing")
  island.assignments = [{
    connectionId: "preloaded-island",
    regionPort1Id: "island-left",
    regionPort2Id: "island-right",
  }]

  const included = createSetupSolvers(graph, false)
  const includedState = snapshotActualState(included.candidate)
  const includedNativeH = included.candidate.computeH
  expect(included.candidate.stats.initialAltActive).toBeUndefined()
  expect(included.candidate.state.regionSegments.flat()).toHaveLength(1)
  included.baseline._setup()
  included.candidate._setup()
  expect(included.baseline.failed).toBeFalse()
  expect(included.candidate.failed).toBeFalse()
  expect(included.candidate.error).toBe(included.baseline.error)
  expect(included.candidate.OUTSIDE_IN_ROUTING).toBeFalse()
  expect(included.candidate.computeH).not.toBe(includedNativeH)
  expect(included.candidate.stats.initialAltActive).toBeTrue()
  expect(included.candidate.stats.initialAltLandmarkCount).toBeGreaterThan(0)
  expect(snapshotActualState(included.candidate)).toBe(includedState)
  expect(snapshotActualState(included.candidate)).toBe(
    snapshotActualState(included.baseline),
  )
  expect(included.candidate.state.candidateQueue.toArray()).toEqual(
    included.baseline.state.candidateQueue.toArray(),
  )
  expect(included.candidate.iterations).toBe(0)

  const excluded = createSetupSolvers(graph, true)
  const excludedState = snapshotActualState(excluded.candidate)
  const excludedNativeH = excluded.candidate.computeH
  excluded.baseline._setup()
  excluded.candidate._setup()
  expect(excluded.candidate.OUTSIDE_IN_ROUTING).toBeTrue()
  expect(excluded.candidate.failed).toBeFalse()
  expect(excluded.candidate.computeH).toBe(excludedNativeH)
  expect(excluded.candidate.computeH).toBe(excluded.baseline.computeH)
  expect(excluded.candidate.stats).toEqual(excluded.baseline.stats)
  expect(excluded.candidate.stats.initialAltActive).toBeUndefined()
  expect(snapshotActualState(excluded.candidate)).toBe(excludedState)
  expect(snapshotActualState(excluded.candidate)).toBe(
    snapshotActualState(excluded.baseline),
  )
  expect(excluded.candidate.state.candidateQueue.toArray()).toEqual(
    excluded.baseline.state.candidateQueue.toArray(),
  )

  const disconnectedGraph = createDetourFixture()
  disconnectedGraph.connections![0]!.endRegionId = "island-b"
  const failed = createSetupSolvers(disconnectedGraph, false)
  const failedState = snapshotActualState(failed.candidate)
  const failedNativeH = failed.candidate.computeH
  failed.baseline._setup()
  failed.candidate._setup()
  expect(failed.baseline.failed).toBeTrue()
  expect(failed.candidate.failed).toBeTrue()
  expect(failed.candidate.error).toBe(failed.baseline.error)
  expect(failed.candidate.error).not.toBeNull()
  expect(failed.candidate.stats.staticallyUnroutableRouteCount).toBe(1)
  expect(failed.candidate.computeH).toBe(failedNativeH)
  expect(failed.candidate.computeH).toBe(failed.baseline.computeH)
  expect(failed.candidate.stats).toEqual(failed.baseline.stats)
  expect(failed.candidate.stats.initialAltActive).toBeUndefined()
  expect(snapshotActualState(failed.candidate)).toBe(failedState)
  expect(snapshotActualState(failed.candidate)).toBe(
    snapshotActualState(failed.baseline),
  )
  expect(failed.candidate.state.candidateQueue.toArray()).toEqual(
    failed.baseline.state.candidateQueue.toArray(),
  )
})
