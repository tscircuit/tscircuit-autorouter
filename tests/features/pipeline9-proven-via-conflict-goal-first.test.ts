import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/selective-rerip-tiny-hyper-graph-solver"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { ProvenViaConflictOracle } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/ProvenViaConflictOracle"

test("via conflict guards survive production heap replacement and reject a goal-first shortcut without starving its legal detour", () => {
  const region = { center: { x: 0, y: 0 }, width: 2, height: 2 }
  const topology: TinyHyperGraphTopology = {
    portCount: 4, regionCount: 2,
    regionIncidentPorts: [[0, 3, 1, 2], [1, 2]], incidentPortRegion: [[0], [0, 1], [0, 1], [0]],
    regionWidth: new Float64Array([2, 4]), regionHeight: new Float64Array([2, 2]), regionCenterX: new Float64Array([0, 3]), regionCenterY: new Float64Array([0, 0]),
    regionAvailableZMask: new Int32Array([9, 9]), regionMetadata: [region, { center: { x: 3, y: 0 }, width: 4, height: 2 }],
    portAngleForRegion1: new Int32Array([18000, 3000, 33000, 0]), portAngleForRegion2: new Int32Array([0, 15000, 21000, 0]),
    portX: new Float64Array([-1, 1, 1, 0]), portY: new Float64Array([0, 0.5, -0.5, 0]), portZ: new Int32Array([0, 0, 3, 3]),
  }
  const problem: TinyHyperGraphProblem = { routeCount: 1, routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([3]), routeNet: new Int32Array([0]), regionNetId: new Int32Array([-1, -1]), portSectionMask: new Int8Array([1, 1, 1, 1]) }
  for (const Solver of [DistanceAwareTinyHyperGraphSolver, SelectiveReripTinyHyperGraphSolver, SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments]) {
    const oracle = new ProvenViaConflictOracle({ layerCount: 4, obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 2.2, height: 2.2, layers: ["inner1"], connectedTo: [] }], viaDiameter: 0.3, clearance: 0, allowBlindAndBuriedVias: false })
    const solver = new Solver(structuredClone(topology), structuredClone(problem), { MAX_ITERATIONS: 100, GREEDY_FINAL_ROUTE_ITERS: 0, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false })
    const constructorQueue = solver.state.candidateQueue
    oracle.install(solver)
    oracle.install(solver)
    solver.step()
    expect(solver.state.candidateQueue).not.toBe(constructorQueue)
    expect(solver.state.candidateQueue.length).toBeGreaterThan(0)
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(solver.iterations).toBeLessThan(100)
    expect(solver.state.regionSegments[1]!.length).toBeGreaterThan(0)
    for (const [, from, to] of solver.state.regionSegments[0]!) expect(topology.portZ[from]).toBe(topology.portZ[to])
    expect(oracle.stats.learnedViaRegionCuts).toBe(1)
    expect(oracle.stats.rejectedViaTransitions).toBeGreaterThan(0)
  }
})
