import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { allocateCompatibleTinyRouteCandidates } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/allocateCompatibleTinyRouteCandidates"

test("finite candidate master crosses a pressure barrier requiring two non-conflicting whole nets to change together", (): void => {
  const ids = Array.from({ length: 8 }, (_, i) => i)
  const topology: TinyHyperGraphTopology = {
    portCount: 8, regionCount: 2, regionIncidentPorts: [ids, ids], incidentPortRegion: ids.map(() => [0, 1]),
    regionWidth: new Float64Array([10, 10]), regionHeight: new Float64Array([10, 10]), regionCenterX: new Float64Array(2), regionCenterY: new Float64Array(2), regionAvailableZMask: new Int32Array([3, 3]),
    regionMetadata: [{ serializedRegionId: "left" }, { serializedRegionId: "right" }], portMetadata: ids.map((i) => ({ serializedPortId: `p${i}` })),
    portX: new Float64Array([-2, 2, -2, 2, 0, 0, 0, 0]), portY: new Float64Array([-1, -1, 1, 1, -4, 4, -1, 1]), portZ: new Int32Array(8),
    portAngleForRegion1: new Int32Array([18000, 0, 18000, 0, 27000, 9000, 27000, 9000]), portAngleForRegion2: new Int32Array([18000, 0, 18000, 0, 27000, 9000, 27000, 9000]),
  }
  const create = (alternative: boolean): TinyHyperGraphSolver => {
    const solver = new TinyHyperGraphSolver(structuredClone(topology), { routeCount: 2, routeStartPort: new Int32Array([0, 2]), routeEndPort: new Int32Array([1, 3]), routeNet: new Int32Array([0, 1]), regionNetId: new Int32Array([-1, -1]), portSectionMask: new Int8Array(8).fill(1), routeMetadata: [{ connectionId: "a" }, { connectionId: "b" }] })
    for (let route = 0; route < 2; route++) {
      const region = alternative ? 1 - route : route
      const portal = 4 + route + Number(alternative) * 2
      const segments: [number, number, number][] = [[route, route * 2, portal], [route, portal, route * 2 + 1]]
      solver.state.regionSegments[region]!.push(...segments)
      solver.state.currentRouteNetId = route
      for (const [, from, to] of segments) {
        solver.appendSegmentToRegionCache(region, from, to)
        solver.state.portAssignment[from] = route
        solver.state.portAssignment[to] = route
      }
    }
    solver.state.currentRouteNetId = undefined
    solver.state.unroutedRoutes = []
    solver.solved = true
    return solver
  }
  const primary = create(false)
  const stats = allocateCompatibleTinyRouteCandidates(primary, create(true), { hasPreloadedCopper: false })
  expect(stats.jointCandidateMaximumExchangeSize).toBe(2)
  expect(stats.jointCandidateHybridNetCount).toBe(2)
  expect(stats.jointCandidateMasterComponents).toBe(1)
  expect(stats.jointCandidateCompleteComponents).toBe(1)
  expect(stats.jointCandidateMasterBudgetExhausted).toBe(0)
  expect(primary.state.regionSegments[0]!.every(([route]) => route === 1)).toBe(true)
  expect(primary.state.regionSegments[1]!.every(([route]) => route === 0)).toBe(true)
})
