import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_Parallel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/AutoroutingPipelineSolver9_Parallel"
import { ParallelPortPointPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortPointPathingSolver"
import { TinyBitsetSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyBitsetSelectiveReripHyperGraphSolver"
import { TinyIndexedSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyIndexedSelectiveReripHyperGraphSolver"
import { TinyCachedCostCongestionAwareFinalRouteSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyCachedCostCongestionAwareFinalRouteSolver"
import { TinyBitsetCongestionAwareFinalRouteSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyBitsetCongestionAwareFinalRouteSolver"
import type { TinyBitsetRegionCostDiagnostics } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyBitsetRegionCostCache"
import type { TinyHyperGraphSolver, TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

type PathingInput = ConstructorParameters<typeof ParallelPortPointPathingSolver>[0]
type InstrumentedTiny = TinyHyperGraphSolver & {
  createGreedyFinalRouteSolver: (options: TinyHyperGraphSolverOptions, attempt: number) => TinyHyperGraphSolver
}
type TinyPipelineHarness = { getSolver: (name: string) => InstrumentedTiny | undefined }
type CompletionChild = {
  attempt: number
  constructorName: string
  iterations: number
  maximumIterations: number
  solved: boolean
  failed: boolean
  ripCount: number
  usesCostCache: boolean
  usesStaticAnglePrefixes: boolean
  costCacheDiagnostics?: TinyBitsetRegionCostDiagnostics
  beforeSolve: unknown
  afterSolve: unknown
  stats: TinyHyperGraphSolver["stats"]
}

function completionPolicyStates(children: CompletionChild[]): unknown[] {
  return children.map(({
    constructorName: _constructorName, usesCostCache: _usesCostCache,
    usesStaticAnglePrefixes: _usesStaticAnglePrefixes,
    costCacheDiagnostics: _diagnostics, ...policyState
  }) => policyState)
}

function captureRoutingState(tiny: TinyHyperGraphSolver): unknown {
  const counters = tiny as unknown as {
    routeAttemptCountByRouteId: Uint32Array
    routeSuccessCountByRouteId: Uint32Array
  }
  return structuredClone({
    iterations: tiny.iterations, maximumIterations: tiny.MAX_ITERATIONS, stats: tiny.stats,
    portAssignment: tiny.state.portAssignment, regionSegments: tiny.state.regionSegments,
    regionIntersectionCaches: tiny.state.regionIntersectionCaches,
    regionCongestionCost: tiny.state.regionCongestionCost, currentRouteId: tiny.state.currentRouteId,
    currentRouteNetId: tiny.state.currentRouteNetId, goalPortId: tiny.state.goalPortId,
    unroutedRoutes: tiny.state.unroutedRoutes, ripCount: tiny.state.ripCount,
    routeAttemptCountByRouteId: counters.routeAttemptCountByRouteId,
    routeSuccessCountByRouteId: counters.routeSuccessCountByRouteId,
    candidateCount: tiny.state.candidateQueue.length,
    candidateQueueClass: tiny.state.candidateQueue.constructor.name,
  })
}
type PathingRun = {
  pathing: ParallelPortPointPathingSolver
  tiny: InstrumentedTiny
  parentAtCompletion?: unknown
  completionChildren: CompletionChild[]
}

function solveWithCompletionCapture(input: PathingInput,
  strategy: "indexed" | "cached-cost" | "adaptive-bitset"): PathingRun {
  const pathing = new ParallelPortPointPathingSolver(input, { strategy })
  const tinyPipeline = (pathing as unknown as { tinyPipelineSolver: TinyPipelineHarness }).tinyPipelineSolver
  while (!tinyPipeline.getSolver("solveGraph") && !pathing.failed && !pathing.solved) pathing.step()
  const tiny = tinyPipeline.getSolver("solveGraph")
  if (!tiny) throw new Error("Pathing parity fixture did not create its native graph solver")
  expect(tiny.iterations).toBe(0)
  if (tiny instanceof TinyBitsetSelectiveReripHyperGraphSolver) tiny.bitsetCostCache.collectDiagnostics = true
  const completionChildren: CompletionChild[] = []
  const result: PathingRun = { pathing, tiny, completionChildren }
  const accept = tiny.tryFinalAcceptance.bind(tiny)
  tiny.tryFinalAcceptance = (): void => {
    result.parentAtCompletion = captureRoutingState(tiny)
    accept()
  }
  const createChild = tiny.createGreedyFinalRouteSolver.bind(tiny)
  tiny.createGreedyFinalRouteSolver = (options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver => {
    const child = createChild(options, attempt)
    expect(child.problem.initialAssignments).toBe(tiny.problem.initialAssignments)
    if (child instanceof TinyCachedCostCongestionAwareFinalRouteSolver) child.bitsetCostCache.collectDiagnostics = true
    const solve = child.solve.bind(child)
    child.solve = (): void => {
      const beforeSolve = captureRoutingState(child)
      solve()
      completionChildren.push({
        attempt, constructorName: child.constructor.name, iterations: child.iterations, maximumIterations: child.MAX_ITERATIONS,
        solved: child.solved, failed: child.failed, ripCount: child.state.ripCount,
        usesCostCache: child instanceof TinyCachedCostCongestionAwareFinalRouteSolver,
        usesStaticAnglePrefixes: child instanceof TinyBitsetCongestionAwareFinalRouteSolver,
        costCacheDiagnostics: child instanceof TinyCachedCostCongestionAwareFinalRouteSolver
          ? { ...child.bitsetCostCache.diagnostics } : undefined,
        beforeSolve, afterSolve: captureRoutingState(child), stats: structuredClone(child.stats),
      })
    }
    return child
  }
  pathing.solve()
  return result
}

test("typed angle-prefix and cached-cost routing preserve exact native SRJ18 paths, PF, caps and routing state", async (): Promise<void> => {
  const diagnostics: Array<Record<string, unknown>> = []
  for (const sample of [1, 6, 16]) {
    const { scenario } = await loadScenarioBySampleNumber("srj18", sample, 1)
    const pipeline = new AutoroutingPipelineSolver9_Parallel(scenario, {
      effort: 1, cacheProvider: null, workerCount: 4, pathingStrategy: "indexed",
    })
    try {
      await pipeline.solveUntilPhaseAsync("portPointPathingSolver")
      expect(pipeline.failed).toBe(false)
      const stage = pipeline.pipelineDef.find((entry) => entry.solverName === "portPointPathingSolver")
      if (!stage) throw new Error("Pipeline9 cached-cost fixture is missing its pathing stage")
      const [params] = stage.getConstructorParams(pipeline)
      const input = params as PathingInput
      expect(input.flags.USE_SELECTIVE_RERIP_ROUTING).toBe(true)
      const indexed = solveWithCompletionCapture(input, "indexed")
      const adaptive = solveWithCompletionCapture(input, "adaptive-bitset")
      const cached = solveWithCompletionCapture(input, "cached-cost")
      expect(indexed.tiny).toBeInstanceOf(TinyIndexedSelectiveReripHyperGraphSolver)
      expect(indexed.tiny).not.toBeInstanceOf(TinyBitsetSelectiveReripHyperGraphSolver)
      expect(cached.tiny).toBeInstanceOf(TinyBitsetSelectiveReripHyperGraphSolver)
      expect(adaptive.tiny).toBeInstanceOf(TinyBitsetSelectiveReripHyperGraphSolver)
      expect(adaptive.pathing.solved).toBe(true)
      expect(adaptive.pathing.failed).toBe(false)
      expect(adaptive.pathing.getOutput()).toEqual(indexed.pathing.getOutput())
      expect(adaptive.pathing.computeNodePfMap()).toEqual(indexed.pathing.computeNodePfMap())
      expect(adaptive.pathing.iterations).toBe(indexed.pathing.iterations)
      expect(adaptive.pathing.MAX_ITERATIONS).toBe(indexed.pathing.MAX_ITERATIONS)
      expect(captureRoutingState(adaptive.tiny)).toEqual(captureRoutingState(indexed.tiny))
      expect(adaptive.parentAtCompletion).toEqual(indexed.parentAtCompletion)
      expect(completionPolicyStates(adaptive.completionChildren)).toEqual(completionPolicyStates(indexed.completionChildren))
      for (const [index, child] of adaptive.completionChildren.entries()) {
        const originalChild = indexed.completionChildren[index]!
        expect(child.usesCostCache).toBe(false)
        if (child.attempt >= 0) {
          expect(child.constructorName).toBe(originalChild.constructorName)
          expect(child.usesStaticAnglePrefixes).toBe(false)
        } else {
          expect(originalChild.constructorName).toBe("CongestionAwareFinalRouteSolver")
          expect(originalChild.usesStaticAnglePrefixes).toBe(false)
          expect(child.constructorName).toBe("TinyBitsetCongestionAwareFinalRouteSolver")
          expect(child.usesStaticAnglePrefixes).toBe(true)
        }
      }
      if (!(cached.tiny instanceof TinyBitsetSelectiveReripHyperGraphSolver)) throw new Error("Cached strategy selected the wrong parent")
      expect(indexed.pathing.solved).toBe(true)
      expect(cached.pathing.solved).toBe(true)
      expect(indexed.pathing.failed).toBe(false)
      expect(cached.pathing.failed).toBe(false)
      expect(cached.pathing.getOutput()).toEqual(indexed.pathing.getOutput())
      expect(cached.pathing.computeNodePfMap()).toEqual(indexed.pathing.computeNodePfMap())
      expect(cached.pathing.iterations).toBe(indexed.pathing.iterations)
      expect(cached.pathing.MAX_ITERATIONS).toBe(indexed.pathing.MAX_ITERATIONS)
      expect(cached.tiny.iterations).toBe(indexed.tiny.iterations)
      expect(cached.tiny.MAX_ITERATIONS).toBe(indexed.tiny.MAX_ITERATIONS)
      expect(cached.tiny.stats).toEqual(indexed.tiny.stats)
      expect(cached.tiny.state.portAssignment).toEqual(indexed.tiny.state.portAssignment)
      expect(cached.tiny.state.regionSegments).toEqual(indexed.tiny.state.regionSegments)
      expect(cached.tiny.state.regionIntersectionCaches).toEqual(indexed.tiny.state.regionIntersectionCaches)
      expect(cached.tiny.state.regionCongestionCost).toEqual(indexed.tiny.state.regionCongestionCost)
      expect(cached.parentAtCompletion).toEqual(indexed.parentAtCompletion)
      expect(completionPolicyStates(cached.completionChildren)).toEqual(completionPolicyStates(indexed.completionChildren))
      for (const [index, child] of cached.completionChildren.entries()) {
        const originalChild = indexed.completionChildren[index]!
        if (child.attempt >= 0) {
          expect(child.constructorName).toBe(originalChild.constructorName)
          expect(child.usesCostCache).toBe(false)
          expect(child.usesStaticAnglePrefixes).toBe(false)
          continue
        }
        expect(originalChild.constructorName).toBe("CongestionAwareFinalRouteSolver")
        expect(originalChild.usesCostCache).toBe(false)
        expect(child.constructorName).toBe("TinyCachedCostCongestionAwareFinalRouteSolver")
        expect(child.usesCostCache).toBe(true)
        expect(child.usesStaticAnglePrefixes).toBe(true)
        expect(child.costCacheDiagnostics?.hits).toBeGreaterThan(0)
        expect(child.costCacheDiagnostics?.misses).toBeGreaterThan(0)
        expect(child.costCacheDiagnostics?.snapshots).toBeGreaterThan(0)
      }
      expect(cached.pathing.stats.candidatePortfolioPrimarySummary).toEqual(indexed.pathing.stats.candidatePortfolioPrimarySummary)
      const indexedMetrics = indexed.pathing.getSolveGraphBenchmarkMetrics()
      const cachedMetrics = cached.pathing.getSolveGraphBenchmarkMetrics()
      if (!indexedMetrics || !cachedMetrics) throw new Error("Solved pathing fixture is missing its counters")
      const { timeMs: _indexedTimeMs, ...indexedCounters } = indexedMetrics
      const { timeMs: _cachedTimeMs, ...cachedCounters } = cachedMetrics
      expect(cachedCounters).toEqual(indexedCounters)
      const counts = cached.tiny.bitsetCostCache.diagnostics
      expect(counts.hits).toBeGreaterThan(0)
      expect(counts.misses).toBeGreaterThan(0)
      expect(counts.snapshots).toBeGreaterThan(0)
      expect(Number.isInteger(counts.capacityMisses)).toBe(true)
      expect(counts.capacityMisses).toBeGreaterThanOrEqual(0)
      diagnostics.push({ sample, parentIterations: cached.tiny.iterations, parentMaximumIterations: cached.tiny.MAX_ITERATIONS,
        ...counts, completionChildren: cached.completionChildren.map(({
          stats: _stats, beforeSolve: _before, afterSolve: _after, ...child
        }) => child) })
      if (sample === 6) {
        expect(cached.parentAtCompletion).toBeDefined()
        expect(cached.tiny.iterations).toBe(2_000_000)
        expect(cached.tiny.MAX_ITERATIONS).toBe(2_000_000)
        expect(cached.tiny.stats.finalRoutingStrategy).toBe("congestion-aware")
        expect(cached.tiny.stats.acceptedGreedyFinalRouteOnTimeout).toBe(true)
        expect(cached.completionChildren).toHaveLength(1)
        expect(cached.completionChildren[0]).toMatchObject({
          attempt: -1, constructorName: "TinyCachedCostCongestionAwareFinalRouteSolver",
          maximumIterations: 4_000_000, iterations: 3_683_422,
          solved: true, failed: false, ripCount: 5, usesCostCache: true,
        })
      }
      if (sample === 16) expect(cached.tiny.stats.outsideInCompletedRouteCount).toBeGreaterThan(0)
    } finally {
      await pipeline.dispose()
    }
  }
  console.log("SRJ18 cached-cost functional parity diagnostics", JSON.stringify(diagnostics))
})
