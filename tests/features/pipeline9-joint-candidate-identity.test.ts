import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { allocateCompatibleTinyRouteCandidates } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/allocateCompatibleTinyRouteCandidates"

test("joint allocation refuses mismatched stable identity, metadata, geometry, permissions and preload provenance", () => {
  const createCandidate = (): TinyHyperGraphSolver => {
    const solver = new TinyHyperGraphSolver({ portCount: 2, regionCount: 1, regionIncidentPorts: [[0, 1]], incidentPortRegion: [[0], [0]], regionWidth: new Float64Array([2]), regionHeight: new Float64Array([2]), regionCenterX: new Float64Array([0]), regionCenterY: new Float64Array([0]), regionAvailableZMask: new Int32Array([1]), portX: new Float64Array([-1, 1]), portY: new Float64Array([0, 0]), portZ: new Int32Array([0, 0]), portAngleForRegion1: new Int32Array([18000, 0]), regionMetadata: [{ serializedRegionId: "region" }], portMetadata: [{ serializedPortId: "start" }, { serializedPortId: "end" }] }, { routeCount: 1, routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([1]), routeNet: new Int32Array([0]), regionNetId: new Int32Array([-1]), portSectionMask: new Int8Array([1, 1]), routeMetadata: [{ connectionId: "connection" }] })
    solver.state.regionSegments[0] = [[0, 0, 1]]
    solver.state.unroutedRoutes = []
    solver.solved = true
    return solver
  }
  const mutations: Array<(solver: TinyHyperGraphSolver) => void> = [
    (s) => { s.topology.portX[0] = -0.9 },
    (s) => { s.topology.portMetadata![0].serializedPortId = "other" },
    (s) => { s.topology.portMetadata![0].pcb_port_id = "other-pad" },
    (s) => { s.topology.regionMetadata![0].serializedRegionId = "other-region" },
    (s) => { s.topology.regionAvailableZMask![0] = 3 },
    (s) => { s.problem.regionNetId[0] = 1 },
    (s) => { s.problem.routeMetadata![0].connectionId = "other-net" },
    (s) => { s.problem.portPenalty = new Float64Array([1, 1]) },
  ]
  for (const mutate of mutations) {
    const primary = createCandidate()
    const other = createCandidate()
    const before = structuredClone(primary.state.regionSegments)
    mutate(other)
    const stats = allocateCompatibleTinyRouteCandidates(primary, other, { hasPreloadedCopper: false })
    expect(stats.jointCandidateTopologyMismatch).toBe(1)
    expect(primary.state.regionSegments).toEqual(before)
  }
  const preloaded = createCandidate()
  preloaded.problem.routeMetadata![0].preloadedTraceSection = { traceId: "immutable" }
  expect(allocateCompatibleTinyRouteCandidates(createCandidate(), preloaded, { hasPreloadedCopper: false }).jointCandidateTopologyMismatch).toBe(1)
  const disconnected = createCandidate()
  disconnected.state.regionSegments[0] = []
  expect(() => allocateCompatibleTinyRouteCandidates(disconnected, createCandidate(), { hasPreloadedCopper: false })).toThrow("connected solved candidate")
})
