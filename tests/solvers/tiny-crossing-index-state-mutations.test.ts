import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, type Candidate, type TinyHyperGraphProblem, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/selective-rerip-tiny-hyper-graph-solver"
import { OutsideInPartialRipTinyHyperGraphSolver } from "tiny-hypergraph/lib/outside-in-partial-rip-tiny-hypergraph-solver"
import { TinyHyperGraphSectionSolver } from "tiny-hypergraph/lib/section-solver"
import { installTinyCrossingIndex } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installTinyCrossingIndex"
import { createTinyCrossingIndexDiagnostics } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyRegionCrossingIndex"

type MutationHooks = {
  replaceBestSolvedState(summary: { maxRegionCost: number; totalRegionCost: number }): void
  restoreBestSolvedState(): void
  rebuildCommittedState(ripped: ReadonlySet<number>): void
  rebuildRetainedRoutingState(segments: Array<[number, number, number][]>, pending: number[]): void
  captureBestState(summary: { maxRegionCost: number; totalRegionCost: number }): void
  restoreBestState(): void
}

test("native append, full/partial/selective rerip, problem reuse and section snapshot restore invalidate crossing tables", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 8, regionCount: 2,
    regionIncidentPorts: [[0, 1, 2, 3, 4, 5, 6, 7], [0, 1, 2, 3, 4, 5, 6, 7]],
    incidentPortRegion: Array.from({ length: 8 }, () => [0, 1]),
    regionWidth: new Float64Array([3.1, 2.7]), regionHeight: new Float64Array([2.3, 3.7]),
    regionCenterX: new Float64Array(2), regionCenterY: new Float64Array(2),
    portAngleForRegion1: new Int32Array([-4, -3, -2, -1, 1, 2, 3, 4]),
    portAngleForRegion2: new Int32Array([4, 3, 2, 1, -1, -2, -3, -4]),
    portX: Float64Array.from({ length: 8 }, (_, i) => Math.cos(i)), portY: Float64Array.from({ length: 8 }, (_, i) => Math.sin(i)), portZ: new Int32Array([0, 0, 1, 1, 0, 1, 0, 1]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 4, routeStartPort: new Int32Array([0, 1, 2, 3]), routeEndPort: new Int32Array([4, 5, 6, 7]), routeNet: new Int32Array([10, 11, 12, 13]),
    portSectionMask: new Int8Array(8).fill(1), regionNetId: new Int32Array(2).fill(-1),
  }
  const diagnostics = createTinyCrossingIndexDiagnostics(true)
  const verify = (solver: TinyHyperGraphSolver): void => {
    for (const net of [10, 11, 99]) for (let from = 0; from < 8; from++) for (let to = 0; to < 8; to++) {
      solver.state.currentRouteNetId = net
      const candidate: Candidate = { portId: from, nextRegionId: 0, g: 0.137, h: 0, f: 0.137 }
      expect(solver.computeG(candidate, to)).toBe(TinyHyperGraphSolver.prototype.computeG.call(solver, candidate, to))
    }
  }
  for (const Constructor of [TinyHyperGraphSolver, SelectiveReripTinyHyperGraphSolver, OutsideInPartialRipTinyHyperGraphSolver]) {
    const solver = new Constructor(topology, structuredClone(problem))
    installTinyCrossingIndex(solver, diagnostics)
    for (let routeId = 0; routeId < 3; routeId++) {
      solver.state.currentRouteNetId = problem.routeNet[routeId]
      solver.state.regionSegments[0]!.push([routeId, routeId, routeId + 4])
      solver.appendSegmentToRegionCache(0, routeId, routeId + 4)
      verify(solver)
    }
    const hooks = solver as unknown as MutationHooks
    hooks.replaceBestSolvedState({ maxRegionCost: 1, totalRegionCost: 1 })
    solver.resetRoutingStateForRerip()
    verify(solver)
    hooks.restoreBestSolvedState()
    verify(solver)
    const buildsBeforeFieldReplacement = diagnostics.crossingIndexBuilds
    const cache = solver.state.regionIntersectionCaches[0]!
    cache.lesserAngles = new Int32Array(cache.lesserAngles)
    cache.lesserAngles[0] = 3
    verify(solver)
    expect(diagnostics.crossingIndexBuilds).toBe(buildsBeforeFieldReplacement + 1)
    hooks.restoreBestSolvedState()
    verify(solver)
    if (Constructor === SelectiveReripTinyHyperGraphSolver) {
      hooks.rebuildCommittedState(new Set([1]))
      expect(solver.state.regionIntersectionCaches[0]!.netIds.length).toBe(2)
      verify(solver)
    } else if (Constructor === OutsideInPartialRipTinyHyperGraphSolver) {
      hooks.rebuildRetainedRoutingState([[[0, 0, 4], [2, 2, 6]], []], [1, 3])
      expect(solver.state.regionIntersectionCaches[0]!.netIds.length).toBe(2)
      verify(solver)
    } else {
      solver.resetForProblem({ ...structuredClone(problem), initialAssignments: [{ routeId: 2, regionId: 0, fromPortId: 2, toPortId: 6 }] })
      expect(solver.state.regionIntersectionCaches[0]!.netIds.length).toBe(1)
      verify(solver)
    }
  }
  const section = new TinyHyperGraphSectionSolver(topology, structuredClone(problem), {
    solvedRoutePathSegments: [[[0, 4]], [[1, 5]], [[2, 6]], [[3, 7]]], solvedRoutePathRegionIds: [[0], [0], [0], [0]],
  })
  section._setup()
  const child = section.sectionSolver!
  installTinyCrossingIndex(child, diagnostics)
  child.state.currentRouteNetId = 10
  child.state.regionSegments[0]!.push([0, 0, 4])
  child.appendSegmentToRegionCache(0, 0, 4)
  verify(child)
  const childHooks = child as unknown as MutationHooks
  childHooks.captureBestState({ maxRegionCost: 1, totalRegionCost: 1 })
  child.resetRoutingStateForRerip()
  verify(child)
  childHooks.restoreBestState()
  verify(child)
  expect(diagnostics.crossingIndexBuilds).toBeGreaterThan(10)
})
