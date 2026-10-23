import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolverWithCandidatePool } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithCandidatePool"
import { TinyHyperGraphSolver, type TinyHyperGraphProblem, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"

test("nonterminal and failed candidate-pool exports preserve the native rejection contract without allocating", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 2,
    regionIncidentPorts: [[0, 1], [0, 1]],
    incidentPortRegion: [[0, 1], [0, 1]],
    regionWidth: new Float64Array([10, 10]),
    regionHeight: new Float64Array([10, 10]),
    regionCenterX: new Float64Array([0, 0]),
    regionCenterY: new Float64Array([0, 0]),
    regionAvailableZMask: new Int32Array([3, 3]),
    portX: new Float64Array([-1, 1]),
    portY: new Float64Array(2),
    portZ: new Int32Array(2),
    portAngleForRegion1: new Int32Array([18000, 0]),
    portAngleForRegion2: new Int32Array([18000, 0]),
    regionMetadata: [{ serializedRegionId: "r0" }, { serializedRegionId: "r1" }],
    portMetadata: [{ serializedPortId: "p0" }, { serializedPortId: "p1" }],
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([-1, -1]),
    portSectionMask: new Int8Array([1, 1]),
    routeMetadata: [{ connectionId: "route" }],
  }
  const base = new TinyHyperGraphSolver(structuredClone(topology), structuredClone(problem))
  const pool = new SelectiveReripTinyHyperGraphSolverWithCandidatePool(topology, problem)
  const nativeError = "convertToSerializedHyperGraph requires a solved, non-failed solver"
  expect(() => base.getOutput()).toThrow(nativeError)
  expect(() => pool.getOutput()).toThrow(nativeError)
  pool.configureCandidatePool(false)
  expect(() => pool.getOutput()).toThrow(nativeError)
  pool.failed = true
  base.failed = true
  expect(() => base.getOutput()).toThrow(nativeError)
  expect(() => pool.getOutput()).toThrow(nativeError)
  expect(pool.stats.jointCandidateFinalizationCount).toBe(0)
  expect(pool.stats.jointCandidateTrials).toBe(0)
  expect(pool.stats.jointCandidateDistinctCaptures).toBe(0)
  expect(pool.iterations).toBe(0)
})
