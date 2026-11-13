import { expect, test } from "bun:test"
import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { BudgetedPreparedPortPointRoutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/BudgetedPreparedPortPointRoutingSolver"
import type { SimpleRouteJson } from "lib/types"
import scenario from "../../fixtures/legacy/assets/e2e3.json"

function startPreparedSearch(effort: number): PreparedPortPointRoutingSolver {
  const pipeline = new Pipeline9(structuredClone(scenario) as SimpleRouteJson, {
    effort,
    cacheProvider: null,
  })
  pipeline.solveUntilPhase("portPointPathingSolver")
  while (!pipeline.solved && !pipeline.failed) {
    const active = pipeline.portPointPathingSolver?.activeSubSolver
    if (active instanceof PreparedPortPointRoutingSolver) {
      expect(active.iterations).toBe(0)
      return active
    }
    pipeline.step()
  }
  throw new Error(
    pipeline.error ?? "The prepared port-point search did not start",
  )
}

test("extended effort accepts a valid baseline route and continues an unfinished search", (): void => {
  const baseline = startPreparedSearch(1)
  baseline.MAX_ITERATIONS = 2
  baseline.solve()
  expect(baseline.solved).toBe(true)
  for (const greedyFinalRouteIterations of [4, 0]) {
    const search = startPreparedSearch(2)
    if (!(search instanceof BudgetedPreparedPortPointRoutingSolver))
      throw new Error("Expected the extended-effort prepared search")
    search.baselineIterationLimit = 2
    search.MAX_ITERATIONS = 1000
    search.GREEDY_FINAL_ROUTE_ITERS = greedyFinalRouteIterations
    search.step()
    search.step()
    expect(search.iterations).toBe(2)
    expect(search.failed).toBe(false)
    expect(search.MAX_ITERATIONS).toBe(1000)
    if (greedyFinalRouteIterations === 4) {
      expect(search.solved).toBe(true)
      expect(search.getOutput()).toEqual(baseline.getOutput())
    } else {
      expect(search.solved).toBe(false)
      search.solve()
      expect(search.solved).toBe(true)
      expect(search.iterations).toBeGreaterThan(2)
      expect(search.iterations).toBeLessThanOrEqual(1000)
    }
  }
})
