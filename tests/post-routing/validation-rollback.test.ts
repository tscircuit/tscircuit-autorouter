import { expect, test } from "bun:test"
import { optimizePostRouting } from "lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { boardFixture, phaseOptions } from "./fixtures"

test("additional validation rejection or error rolls back, and validation copies cannot alter copper or input", () => {
  for (const mode of ["reject", "throw", "mutate"] as const) {
    const input = boardFixture(),
      original = structuredClone(input)
    const options = phaseOptions()
    let calls = 0
    options.validate = (copy) => {
      calls++
      if (calls === 1) return { valid: true, diagnostics: [] }
      if (mode === "throw") throw new Error("native checker failed")
      if (mode === "reject")
        return { valid: false, diagnostics: ["native opens"] }
      copy.srj.minTraceWidth = 0
      copy.traces.length = 0
      return { valid: true, diagnostics: [] }
    }
    const result = optimizePostRouting(input, options)
    expect(calls).toBe(2)
    expect(input).toEqual(original)
    expect(result.status).toBe(mode === "mutate" ? "accepted" : "rejected")
    if (mode !== "mutate") {
      expect(result.traces).toEqual(original.traces)
      expect(result.diagnostics.join(" ")).toContain(
        mode === "reject" ? "native opens" : "native checker failed",
      )
    } else expect(result.traces.length).toBeGreaterThan(1)
  }
})
