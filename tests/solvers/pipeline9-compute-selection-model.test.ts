import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"
import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import {
  ContextualComputeSelectionModel,
  COMPUTE_SELECTION_SUPPORT_PER_STRATEGY,
} from "lib/solvers/HyperHighDensitySolver/ContextualComputeSelectionModel"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("compute selection learns contextual elapsed costs from accepted solver outcomes without changing candidates", async (): Promise<void> => {
  // Replaying identical CPU observations must reproduce exact decisions. The
  // production clock remains real; observed costs may differ between runs.
  let observedClock = 0
  const clock = spyOn(performance, "now").mockImplementation(() => observedClock += 0.125)
  try {
  const nodes: NodeWithPortPoints[] = Array.from({ length: 3 }, (_, index) => ({
    capacityMeshNodeId: `node-${index}`,
    center: { x: index * 8, y: 0 },
    width: 4 + index * 0.2,
    height: 4,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: `c${index}`, x: index * 8 - 2, y: 0, z: 0 },
      { connectionName: `c${index}`, x: index * 8 + 2, y: 0, z: 0 },
    ],
  }))
  const traces: unknown[] = []
  const observations: unknown[] = []
  for (let repeat = 0; repeat < 2; repeat++) {
    getGlobalInMemoryCache().clearCache()
    const solver = new Pipeline9HighDensitySolver({
      nodePortPoints: nodes,
      enableComputeSelection: true,
      fixedHdRoutes: [],
      connMap: new ConnectivityMap({}),
      obstacles: [],
      layerCount: 2,
      viaDiameter: 0.3,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      effort: 1,
    })
    expect(solver.computeSelectionModel.getEvidence().observations).toHaveLength(0)
    if (repeat === 0) solver.solve()
    else {
      const runtime = createPipeline9TestRuntime(4)
      try { await solver.solveAsync(runtime) } finally { await runtime.dispose() }
    }
    expect(solver.solved).toBe(true)
    const evidence = solver.computeSelectionModel.getEvidence()
    expect(evidence.stats.learnedComputeValidOutcomeCount).toBe(3)
    expect(evidence.stats.learnedComputeDecisionCount).toBeGreaterThan(0)
    expect(evidence.stats.learnedComputeValidationCount).toBe(3)
    expect(evidence.stats.learnedComputeKernelEvaluationCount).toBeGreaterThan(0)
    expect(evidence.stats.learnedComputeObservedWinnerOracleWork).toBeGreaterThan(0)
    expect(evidence.stats.learnedComputeObservedWinnerOracleWork).toBeLessThanOrEqual(
      evidence.stats.learnedComputePortfolioWork!,
    )
    expect(evidence.observations.every((entry) => entry.features.every(Number.isFinite))).toBe(true)
    expect(evidence.observations.every((entry) => entry.elapsedMs >= 0)).toBe(true)
    traces.push(solver.routes)
    observations.push(evidence.observations.map(({ elapsedMs: _, ...entry }) => entry))
  }
  expect(traces[0]).toEqual(traces[1])
  expect(observations[0]).toEqual(observations[1])

  const model = new ContextualComputeSelectionModel()
  model.observeNode([
    { nodeId: "observed", features: [0, 0, 0, 0, 0, 0], strategy: "A", work: 2, elapsedMs: 999, outcome: "valid" },
    { nodeId: "observed", features: [0, 0, 0, 0, 0, 0], strategy: "B", work: 8, elapsedMs: 1, outcome: "censored" },
    { nodeId: "observed", features: [0, 0, 0, 0, 0, 0], strategy: "C", work: 3, elapsedMs: 1, outcome: "failed" },
    { nodeId: "observed", features: [0, 0, 0, 0, 0, 0], strategy: "D", work: 3, elapsedMs: 1, outcome: "invalid" },
  ])
  // Strategy A uses fewer iterations but hundreds of times more CPU time.
  expect(model.predict([0, 0, 0, 0, 0, 0], "A").score).toBeGreaterThan(model.predict([0, 0, 0, 0, 0, 0], "B").score)
  expect(model.predict([0, 0, 0, 0, 0, 0], "B").validEvents).toBe(1)
  expect(model.predict([0, 0, 0, 0, 0, 0], "C").validEvents).toBe(1)
  expect(model.predict([0, 0, 0, 0, 0, 0], "D").validEvents).toBe(1)
  expect(model.predict([100, 0, 0, 0, 0, 0], "B").score).toBe(1)
  expect(model.getStats().learnedComputeValidOutcomeCount).toBe(1)
  expect(model.getStats().learnedComputeCensoredOutcomeCount).toBe(1)

  const opts = { nodeWithPortPoints: nodes[0]!, traceWidth: 0.1, obstacleMargin: 0.15 }
  const ordinary = new PortfolioSingleIntraNodeSolver(opts)
  const learned = new PortfolioSingleIntraNodeSolver({ ...opts, computeSelectionModel: model })
  ordinary.initializeSolvers()
  learned.initializeSolvers()
  expect(learned.supervisedSolvers!.map(({ hyperParameters, solver }) => ({
    hyperParameters,
    budget: solver.MAX_ITERATIONS,
  }))).toEqual(ordinary.supervisedSolvers!.map(({ hyperParameters, solver }) => ({
    hyperParameters,
    budget: solver.MAX_ITERATIONS,
  })))
  expect(learned.MAX_ITERATIONS).toBe(ordinary.MAX_ITERATIONS)

  const bounded = new ContextualComputeSelectionModel()
  for (let index = 0; index < COMPUTE_SELECTION_SUPPORT_PER_STRATEGY + 20; index++) {
    bounded.observeNode([{
      nodeId: `support-${index}`,
      features: [0, 0, 0, 0, 0, 0],
      strategy: "A",
      work: 1,
      elapsedMs: 0,
      outcome: "valid",
    }])
  }
  expect(bounded.getStats().learnedComputeObservationCount).toBe(COMPUTE_SELECTION_SUPPORT_PER_STRATEGY + 20)
  expect(bounded.getEvidence().observations).toHaveLength(COMPUTE_SELECTION_SUPPORT_PER_STRATEGY)
  bounded.predict([0, 0, 0, 0, 0, 0], "A")
  expect(bounded.getStats().learnedComputeKernelEvaluationCount).toBe(COMPUTE_SELECTION_SUPPORT_PER_STRATEGY)
  } finally {
    clock.mockRestore()
  }
})
