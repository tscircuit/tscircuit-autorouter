import { expect, test } from "bun:test"
import { optimizePostRouting } from "lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { boardFixture, phaseOptions } from "./fixtures"

test("expansion budget, explicit no-change limit, and an unmet via-only objective reject without replacing output", () => {
  for (const mode of [
    "budget",
    "grid",
    "states",
    "changed-nets",
    "objective",
  ] as const) {
    const input = boardFixture(),
      original = structuredClone(input)
    const options = phaseOptions()
    if (mode === "budget") options.search.maxExpansions = 1
    if (mode === "grid") options.search.gridStep = 0.0001
    if (mode === "states") {
      options.search.gridStep = 0.025
      options.nets[0]!.maxNewVias = 32
      options.nets[0]!.maxNewViasPerBranch = 32
      delete options.nets[0]!.componentPlanning
    }
    if (mode === "changed-nets") options.objective.maxChangedNets = 0
    if (mode === "objective") options.objective.priorities = ["viaSites"]
    const result = optimizePostRouting(input, options)
    expect(result.status).toBe("rejected")
    expect(result.traces).toEqual(original.traces)
    expect(result.changedNets).toEqual([])
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(input).toEqual(original)
  }
})
