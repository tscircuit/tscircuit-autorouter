import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { TinyHyperGraphSectionSolver } from "tiny-hypergraph/lib/section-solver"
import { TinyHyperGraphSectionPipelineSolver } from "tiny-hypergraph/lib/section-solver/TinyHyperGraphSectionPipelineSolver"
import { allocateCompatibleTinyRouteCandidates } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/allocateCompatibleTinyRouteCandidates"

test("ordinary section reconstruction remains eligible while original physical preloads exclude mixing", () => {
  const original = new TinyHyperGraphSolver({
    portCount: 2,
    regionCount: 2,
    regionIncidentPorts: [[0, 1], [0, 1]],
    incidentPortRegion: [[0, 1], [0, 1]],
    regionWidth: new Float64Array([2, 2]),
    regionHeight: new Float64Array([2, 2]),
    regionCenterX: new Float64Array([0, 0]),
    regionCenterY: new Float64Array([0, 0]),
    regionAvailableZMask: new Int32Array([1, 1]),
    portX: new Float64Array([-1, 1]),
    portY: new Float64Array([0, 0]),
    portZ: new Int32Array([0, 0]),
    portAngleForRegion1: new Int32Array([18000, 0]),
    portAngleForRegion2: new Int32Array([18000, 0]),
    regionMetadata: [{ serializedRegionId: "r0" }, { serializedRegionId: "r1" }],
    portMetadata: [{ serializedPortId: "a" }, { serializedPortId: "b" }],
  }, {
    routeCount: 1,
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([-1, -1]),
    portSectionMask: new Int8Array([1, 1]),
    routeMetadata: [{ connectionId: "connection", mutuallyConnectedNetworkId: "net" }],
  })
  original.solve()
  expect(original.solved).toBe(true)
  const pipeline = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: original.getOutput(),
    createSectionMask: ({ topology }) => new Int8Array(topology.portCount),
  })
  pipeline.solve()
  const selected = pipeline.getSolver<TinyHyperGraphSectionSolver>("optimizeSection")!.getSolvedSolver()
  expect(selected.problem.initialAssignments!.length).toBeGreaterThan(0)
  expect(selected.problem.routeMetadata!.some((route) => route.preloadedTraceSection)).toBe(false)
  const before = structuredClone(selected.state.regionSegments)
  const blocked = allocateCompatibleTinyRouteCandidates(selected, selected, { hasPreloadedCopper: true })
  expect(blocked.jointCandidatePreloadedUnavailable).toBe(1)
  const ordinary = allocateCompatibleTinyRouteCandidates(selected, selected, { hasPreloadedCopper: false })
  expect(ordinary.jointCandidatePreloadedUnavailable).toBe(0)
  expect(ordinary.jointCandidateEligibleBoards).toBe(1)
  expect(ordinary.jointCandidateTrials).toBe(0)
  expect(selected.state.regionSegments).toEqual(before)
})
