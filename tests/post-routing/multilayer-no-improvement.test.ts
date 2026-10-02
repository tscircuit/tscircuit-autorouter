import { expect, test } from "bun:test"
import { optimizePostRouting } from "lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { boardFixture, phaseOptions } from "./fixtures"

test("a four-layer candidate with unchanged vias rolls back under a via-only objective", () => {
  const input = boardFixture()
  input.srj.layerCount = 4
  const original = structuredClone(input)
  const options = phaseOptions()
  options.objective.priorities = ["viaSites"]
  const result = optimizePostRouting(input, options)
  expect(result.status).toBe("rejected")
  expect(result.validationStatus).toBe("validated")
  expect(result.before!.viaSites).toBe(0)
  expect(result.candidateMetrics!.viaSites).toBe(0)
  expect(result.diagnostics).toContain(
    "No strict improvement under declared objective",
  )
  expect(result.traces).toEqual(input.traces)
  expect(result.changedNets).toEqual([])
  expect(input).toEqual(original)
  options.search.maxExpansions = 1
  const exhausted = optimizePostRouting(input, options)
  expect(exhausted.status).toBe("rejected")
  expect(exhausted.traces).toEqual(input.traces)
  expect(exhausted.attempts[0]!.solved).toBe(false)
})
