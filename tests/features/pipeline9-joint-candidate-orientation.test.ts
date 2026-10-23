import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolverWithCandidatePool } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithCandidatePool"
import { allocateCompatibleTinyRouteCandidates } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/allocateCompatibleTinyRouteCandidates"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"

test("reversing and reordering native segment edges cannot create candidate diversity or allocation trials", (): void => {
  const native = new SelectiveReripTinyHyperGraphSolverWithCandidatePool({
    portCount: 3,
    regionCount: 2,
    regionIncidentPorts: [[0, 1, 2], [0, 1, 2]],
    incidentPortRegion: [[0, 1], [0, 1], [0, 1]],
    regionWidth: new Float64Array([10, 10]),
    regionHeight: new Float64Array([10, 10]),
    regionCenterX: new Float64Array([0, 0]),
    regionCenterY: new Float64Array([0, 0]),
    regionAvailableZMask: new Int32Array([3, 3]),
    portX: new Float64Array([-1, 0, 1]),
    portY: new Float64Array(3),
    portZ: new Int32Array(3),
    portAngleForRegion1: new Int32Array([18000, 9000, 0]),
    portAngleForRegion2: new Int32Array([18000, 9000, 0]),
    regionMetadata: [{ serializedRegionId: "r0" }, { serializedRegionId: "r1" }],
    portMetadata: Array.from({ length: 3 }, (_, i) => ({ serializedPortId: `p${i}` })),
  }, {
    routeCount: 1,
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([2]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([-1, -1]),
    portSectionMask: new Int8Array(3).fill(1),
    routeMetadata: [{ connectionId: "route" }],
  })
  native.configureCandidatePool(false)
  native.state.portAssignment.fill(0)
  native.state.regionSegments[0] = [[0, 0, 1], [0, 1, 2]]
  native.state.currentRouteNetId = 0
  for (const [, from, to] of native.state.regionSegments[0]) {
    native.appendSegmentToRegionCache(0, from, to)
  }
  native.state.currentRouteNetId = undefined
  native.state.unroutedRoutes = []
  native.onAllRoutesRouted()
  native.state.regionSegments[0] = [[0, 2, 1], [0, 1, 0]]
  native.onAllRoutesRouted()
  const output = native.getOutput()
  expect(native.stats.jointCandidateCompleteRounds).toBe(2)
  expect(native.stats.jointCandidateDistinctCaptures).toBe(1)
  expect(native.stats.jointCandidateRetainedCandidates).toBe(0)
  expect(native.stats.jointCandidatePeakRetainedCandidates).toBe(1)
  expect(native.stats.jointCandidateAvailableBoards).toBe(0)
  expect(native.stats.jointCandidateTrials).toBe(0)
  expect(native.stats.jointCandidateFinalizationCount).toBe(1)
  expect(native.getOutput()).toEqual(output)

  const reversed = new TinyHyperGraphSolver(structuredClone(native.topology), structuredClone(native.problem))
  reversed.state.regionSegments[0] = [[0, 2, 1], [0, 1, 0]]
  reversed.state.portAssignment.fill(0)
  reversed.state.currentRouteNetId = 0
  for (const [, from, to] of reversed.state.regionSegments[0]) {
    reversed.appendSegmentToRegionCache(0, from, to)
  }
  reversed.state.currentRouteNetId = undefined
  reversed.state.unroutedRoutes = []
  reversed.solved = true
  const allocation = allocateCompatibleTinyRouteCandidates(native, reversed, { hasPreloadedCopper: false })
  expect(allocation.jointCandidateDistinctNetGroups).toBe(0)
  expect(allocation.jointCandidateTrials).toBe(0)
})
