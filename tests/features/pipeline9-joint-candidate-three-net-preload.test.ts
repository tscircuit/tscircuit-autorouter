import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { allocateCompatibleTinyRouteCandidates } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/allocateCompatibleTinyRouteCandidates"

test("joint master exchanges a three-net ownership cycle while keeping physical preload copper exactly fixed", () => {
  const ids = Array.from({ length: 11 }, (_, i) => i)
  const topology: TinyHyperGraphTopology = {
    portCount: 11, regionCount: 2,
    regionIncidentPorts: [ids, ids], incidentPortRegion: ids.map(() => [0, 1]),
    regionWidth: new Float64Array([10, 10]), regionHeight: new Float64Array([10, 10]), regionCenterX: new Float64Array([0, 0]), regionCenterY: new Float64Array([0, 0]), regionAvailableZMask: new Int32Array([3, 3]),
    regionMetadata: [{ serializedRegionId: "crowded" }, { serializedRegionId: "other" }], portMetadata: ids.map((i) => ({ serializedPortId: `p${i}` })),
    portX: new Float64Array([-2, 2, -2, 2, -2, 2, -2, 2, 0, 0, 0]), portY: new Float64Array([-1, -1, 0, 0, 1, 1, 3, 3, -1, 0, 1]), portZ: new Int32Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]),
    portAngleForRegion1: new Int32Array([18000, 0, 18000, 0, 18000, 0, 10000, 8000, 27000, 9000, 4500]), portAngleForRegion2: new Int32Array([18000, 0, 18000, 0, 18000, 0, 10000, 8000, 27000, 9000, 4500]),
  }
  const create = (alternative: boolean): TinyHyperGraphSolver => {
    const solver = new TinyHyperGraphSolver(structuredClone(topology), { routeCount: 4, routeStartPort: new Int32Array([0, 2, 4, 6]), routeEndPort: new Int32Array([1, 3, 5, 7]), routeNet: new Int32Array([0, 1, 2, 3]), regionNetId: new Int32Array([-1, -1]), portSectionMask: new Int8Array(11).fill(1), routeMetadata: [{ connectionId: "a" }, { connectionId: "b" }, { connectionId: "c" }, { connectionId: "physical", preloadedTraceSection: { traceId: "kept" } }] })
    const region = alternative ? 1 : 0
    for (let route = 0; route < 3; route++) {
      const portal = 8 + (route + Number(alternative)) % 3
      solver.state.regionSegments[region]!.push([route, route * 2, portal], [route, portal, route * 2 + 1])
    }
    solver.state.regionSegments[region]!.push([3, 6, 7])
    for (const [route, from, to] of solver.state.regionSegments[region]!) {
      solver.state.currentRouteNetId = route
      solver.appendSegmentToRegionCache(region, from, to)
      solver.state.portAssignment[from] = route
      solver.state.portAssignment[to] = route
    }
    solver.state.currentRouteNetId = undefined
    solver.state.unroutedRoutes = []
    solver.solved = true
    return solver
  }
  const primary = create(false)
  const alternative = create(true)
  const stats = allocateCompatibleTinyRouteCandidates(primary, [alternative], { hasPreloadedCopper: true })
  expect(stats.jointCandidateEligibleBoards).toBe(1)
  expect(stats.jointCandidatePreloadedLockedNetCount).toBe(1)
  expect(stats.jointCandidateMaximumExchangeSize).toBe(3)
  expect(stats.jointCandidateHybridNetCount).toBe(3)
  expect(stats.jointCandidateMasterStates).toBeGreaterThan(0)
  expect(primary.state.regionSegments[0]).toEqual([[3, 6, 7]])
  expect(primary.state.regionSegments[1]).toHaveLength(6)
  expect(primary.state.portAssignment[8]).toBe(2)
  expect(primary.state.portAssignment[9]).toBe(0)
  expect(primary.state.portAssignment[10]).toBe(1)
})
