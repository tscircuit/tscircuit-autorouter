import { expect, test } from "bun:test"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { ParallelPortPointPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortPointPathingSolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

type CompletionOutcome = {
  attempt: number
  iterations: number
  cap: number
  solved: boolean
  failed: boolean
  state: Record<string, unknown>
  attempts: Uint32Array
  successes: Uint32Array
}

type SearchCounters = { routeAttemptCountByRouteId: Uint32Array; routeSuccessCountByRouteId: Uint32Array }

function captureCompletions(pathing: TinyHypergraphPortPointPathingSolver): { tiny: TinyHyperGraphSolver; outcomes: CompletionOutcome[] } {
  const pipeline = (pathing as unknown as { tinyPipelineSolver: { getSolver(name: string): TinyHyperGraphSolver | undefined } }).tinyPipelineSolver
  while (!pipeline.getSolver("solveGraph")) pathing.step()
  const tiny = pipeline.getSolver("solveGraph")!
  const host = tiny as unknown as { createGreedyFinalRouteSolver(options: unknown, attempt: number): TinyHyperGraphSolver }
  const factory = host.createGreedyFinalRouteSolver
  const outcomes: CompletionOutcome[] = []
  host.createGreedyFinalRouteSolver = function (options, attempt): TinyHyperGraphSolver {
    const child = factory.call(this, options, attempt)
    const solve = child.solve
    child.solve = function (): void {
      solve.call(this)
      const { candidateQueue: _queue, ...state } = this.state
      outcomes.push({ attempt, iterations: this.iterations, cap: this.MAX_ITERATIONS,
        solved: this.solved, failed: this.failed, state: structuredClone(state),
        attempts: this.routeAttemptCountByRouteId.slice(), successes: this.routeSuccessCountByRouteId.slice() })
    }
    return child
  }
  return { tiny, outcomes }
}

test("active incidence keeps complete SRJ18 006 native parent and completion paths, states and iteration caps", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 6, 1)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, { effort: 1, cacheProvider: null })
  pipeline.solveUntilPhase("portPointPathingSolver")
  expect(pipeline.failed).toBe(false)
  const stage = pipeline.pipelineDef.find((entry) => entry.solverName === "portPointPathingSolver")
  if (!stage) throw new Error("Native incidence parity fixture is missing pathing")
  const [params] = stage.getConstructorParams(pipeline)
  const input = params as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]
  const native = new TinyHypergraphPortPointPathingSolver(structuredClone(input))
  const expected = captureCompletions(native)
  native.solve()
  expect(native.solved).toBe(true)
  expect(expected.tiny.iterations).toBe(2_000_000)
  expect(expected.outcomes.map(({ attempt, iterations, cap }) => ({ attempt, iterations, cap })))
    .toEqual([{ attempt: -1, iterations: 3_683_422, cap: 4_000_000 }])
  for (const strategy of ["indexed", "adaptive-bitset"] as const) {
    const parallel = new ParallelPortPointPathingSolver(structuredClone(input), { strategy })
    const actual = captureCompletions(parallel)
    parallel.solve()
    expect(parallel.solved).toBe(true)
    expect(parallel.failed).toBe(false)
    expect(parallel.getOutput()).toEqual(native.getOutput())
    expect(parallel.computeNodePfMap()).toEqual(native.computeNodePfMap())
    expect(parallel.iterations).toBe(native.iterations)
    expect(parallel.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
    const { timeMs: _nativeTime, ...nativeMetrics } = native.getSolveGraphBenchmarkMetrics()!
    const { timeMs: _parallelTime, ...parallelMetrics } = parallel.getSolveGraphBenchmarkMetrics()!
    expect(parallelMetrics).toEqual(nativeMetrics)
    expect(actual.outcomes).toEqual(expected.outcomes)
    const { candidateQueue: expectedQueue, ...expectedState } = expected.tiny.state
    const { candidateQueue: actualQueue, ...actualState } = actual.tiny.state
    expect(actualState).toEqual(expectedState)
    expect(actualQueue.toArray()).toEqual(expectedQueue.toArray())
    const actualCounters = actual.tiny as unknown as SearchCounters
    const expectedCounters = expected.tiny as unknown as SearchCounters
    expect(actualCounters.routeAttemptCountByRouteId).toEqual(expectedCounters.routeAttemptCountByRouteId)
    expect(actualCounters.routeSuccessCountByRouteId).toEqual(expectedCounters.routeSuccessCountByRouteId)
  }
})
