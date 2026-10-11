import { NegotiateTraceClearanceSolver } from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { Pipeline9DenseNegotiateTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/Pipeline9DenseNegotiateTraceClearanceSolver"
import { negotiationInput } from "../fixtures/repair04StepFixtures"

test("dense negotiated paths preserve route displacement, queue order and bounded work", (): void => {
  for (const heuristicWeight of [1, 3]) {
    const input = {
      ...negotiationInput,
      pathHeuristicWeight: heuristicWeight,
      maxPathSearchNodes: 20_000,
      maxPathSearchCalls: 64,
    }
    const baseline = new NegotiateTraceClearanceSolver(input)
    const dense = new Pipeline9DenseNegotiateTraceClearanceSolver(input)
    while (!baseline.solved && !baseline.failed) {
      baseline.step()
      dense.step()
      expect(dense.stats).toEqual(baseline.stats)
      expect(dense.progress).toBe(baseline.progress)
      expect(dense.solved).toBe(baseline.solved)
    }
    expect(dense.failed).toBeFalse()
    expect(dense.getOutput()).toEqual(baseline.getOutput())
    expect(dense.iterations).toBe(baseline.iterations)
    expect(dense.MAX_ITERATIONS).toBe(baseline.MAX_ITERATIONS)
    expect(dense.stats.pathSearchNodes).toBeGreaterThan(0)
    expect(dense.stats.pathSearchCalls).toBeGreaterThan(0)
  }
})
