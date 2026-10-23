import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { allocateCompatibleTinyRouteCandidates } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/allocateCompatibleTinyRouteCandidates"

test("atomic two-net candidate exchange resolves reciprocal port ownership and keeps the third net's primary route", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 8, regionCount: 2,
    regionIncidentPorts: [[0, 1, 2, 3, 4, 5, 6, 7], [0, 1, 2, 3, 4, 5, 6, 7]], incidentPortRegion: Array.from({ length: 8 }, () => [0, 1]),
    regionWidth: new Float64Array([10, 10]), regionHeight: new Float64Array([10, 10]), regionCenterX: new Float64Array([0, 0]), regionCenterY: new Float64Array([0, 0]), regionAvailableZMask: new Int32Array([3, 3]),
    regionMetadata: [{ serializedRegionId: "r0" }, { serializedRegionId: "r1" }],
    portMetadata: Array.from({ length: 8 }, (_, i) => ({ serializedPortId: `p${i}` })),
    portAngleForRegion1: new Int32Array([18000, 0, 18000, 0, 10800, 7200, 9000, 27000]), portAngleForRegion2: new Int32Array([18000, 0, 18000, 0, 10800, 7200, 9000, 27000]),
    portX: new Float64Array([-1, 1, -1, 1, -1, 1, 0, 0]), portY: new Float64Array([0, 0, 0, 0, 3, 3, 1, -1]), portZ: new Int32Array([0, 0, 0, 0, 0, 0, 1, 1]),
  }
  const createCandidate = (alternative: boolean): TinyHyperGraphSolver => {
    const solver = new TinyHyperGraphSolver(structuredClone(topology), { routeCount: 3, routeStartPort: new Int32Array([0, 2, 4]), routeEndPort: new Int32Array([1, 3, 5]), routeNet: new Int32Array([0, 1, 2]), regionNetId: new Int32Array([-1, -1]), portSectionMask: new Int8Array(8).fill(1), routeMetadata: [{ connectionId: "a" }, { connectionId: "b" }, { connectionId: "c" }] })
    const region = alternative ? 1 : 0
    const aPortal = alternative ? 7 : 6
    const bPortal = alternative ? 6 : 7
    solver.state.regionSegments[region] = [[0, 0, aPortal], [0, aPortal, 1], [1, 2, bPortal], [1, bPortal, 3], [2, 4, 5]]
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
  const primary = createCandidate(false)
  const alternative = createCandidate(true)
  primary.resetRoutingStateForRerip = (): void => {
    throw new Error("Publishing a hybrid must not restore an older rerip snapshot")
  }
  const stats = allocateCompatibleTinyRouteCandidates(primary, alternative, { hasPreloadedCopper: false })
  expect(stats.jointCandidateEligibleBoards).toBe(1)
  expect(stats.jointCandidateSimultaneousExchanges).toBeGreaterThan(0)
  expect(stats.jointCandidateHybridNetCount).toBe(2)
  expect(primary.state.regionSegments[0]).toEqual([[2, 4, 5]])
  expect(primary.state.regionSegments[1]!.length).toBe(4)
  expect(primary.state.portAssignment[6]).toBe(1)
  expect(primary.state.portAssignment[7]).toBe(0)
  expect(primary.state.unroutedRoutes).toEqual([])
  expect(primary.solved).toBe(true)
  expect(alternative.state.regionSegments[1]!.length).toBe(5)
})
