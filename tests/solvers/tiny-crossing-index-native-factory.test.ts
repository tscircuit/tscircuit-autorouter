import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, getTinyHyperGraphSolverOptions, type Candidate, type TinyHyperGraphProblem, type TinyHyperGraphSolverOptions, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/selective-rerip-tiny-hyper-graph-solver"
import { installTinyCrossingIndex } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installTinyCrossingIndex"
import { createTinyCrossingIndexDiagnostics } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyRegionCrossingIndex"

type Factory = { createGreedyFinalRouteSolver(options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver }

test("instance factory indexing preserves native congestion, zero-cost, custom scorer and module ownership contracts", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 3, regionCount: 3, regionIncidentPorts: [[0, 1], [1], [0, 2]], incidentPortRegion: [[0, 2], [0, 1], [2]],
    regionWidth: new Float64Array([3, 3, 3]), regionHeight: new Float64Array([3, 3, 3]), regionCenterX: new Float64Array(3), regionCenterY: new Float64Array(3),
    portAngleForRegion1: new Int32Array([0, 100, 200]), portAngleForRegion2: new Int32Array([300, 400, 500]),
    portX: new Float64Array([0, 1, 2]), portY: new Float64Array(3), portZ: new Int32Array([0, 1, 0]),
  }
  const problem: TinyHyperGraphProblem = { routeCount: 1, portSectionMask: new Int8Array([1, 1, 1]), routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([2]), routeNet: new Int32Array([0]), regionNetId: new Int32Array([-1, -1, -1]) }
  const diagnostics = createTinyCrossingIndexDiagnostics()
  const originalPrototype = TinyHyperGraphSolver.prototype.computeG
  const indexed = new SelectiveReripTinyHyperGraphSolver(topology, problem, { MAX_ITERATIONS: 271, GREEDY_FINAL_ROUTE_ITERS: 4 })
  const native = new SelectiveReripTinyHyperGraphSolver(topology, problem, { MAX_ITERATIONS: 271, GREEDY_FINAL_ROUTE_ITERS: 4 })
  installTinyCrossingIndex(indexed, diagnostics)
  const installedMethod = indexed.computeG
  installTinyCrossingIndex(indexed, diagnostics)
  expect(indexed.computeG).toBe(installedMethod)
  expect(native.computeG).toBe(originalPrototype)
  for (const attempt of [-1, 0]) {
    const options = getTinyHyperGraphSolverOptions(native)
    const controlChild = (native as unknown as Factory).createGreedyFinalRouteSolver(options, attempt)
    const indexedChild = (indexed as unknown as Factory).createGreedyFinalRouteSolver(options, attempt)
    expect(indexedChild.constructor).toBe(controlChild.constructor)
    expect(getTinyHyperGraphSolverOptions(indexedChild)).toEqual(getTinyHyperGraphSolverOptions(controlChild))
    if (attempt < 0) expect(indexedChild.computeG).not.toBe(originalPrototype)
    else expect(indexedChild.computeG).toBe(controlChild.computeG)
    for (const solver of [controlChild, indexedChild]) {
      solver.state.currentRouteNetId = 0
      solver.appendSegmentToRegionCache(0, 0, 1)
    }
    const candidate: Candidate = { portId: 0, nextRegionId: 0, g: 0.137, h: 0, f: 0.137 }
    expect(indexedChild.computeG(candidate, 1)).toBe(controlChild.computeG(candidate, 1))
  }
  class CustomScorer extends TinyHyperGraphSolver {
    override computeG(candidate: Candidate): number {
      const base = candidate.g
      const customPenalty = 7
      const customValue = base + customPenalty
      return customValue
    }
  }
  const custom = new CustomScorer(topology, problem)
  const customMethod = custom.computeG
  installTinyCrossingIndex(custom, diagnostics)
  expect(custom.computeG).toBe(customMethod)
  expect(TinyHyperGraphSolver.prototype.computeG).toBe(originalPrototype)
  expect(diagnostics.crossingIndexInstalledSolvers).toBe(2)
  expect(diagnostics.crossingIndexNativeScorerSolvers).toBe(2)
  expect(diagnostics.crossingIndexQueryDiagnosticsEnabled).toBe(0)
  expect(diagnostics.crossingIndexBuilds).toBe(1)
  expect(diagnostics.crossingIndexQueries).toBe(0)
})
