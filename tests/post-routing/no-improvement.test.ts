import { expect, test } from "bun:test"
import { optimizePostRouting } from "lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { boardFixture, phaseOptions, wireTrace } from "./fixtures"

test("disabled and no-improvement phases preserve complete serialized output", () => {
  const input = boardFixture()
  input.srj.obstacles = []
  input.traces[0] = wireTrace("straight", "signal-pair", [
    [0, 0],
    [10, 0],
  ])
  const original = JSON.stringify(input.traces)
  const disabled = optimizePostRouting(input, {
    ...phaseOptions(),
    enabled: false,
  })
  expect(disabled.status).toBe("disabled")
  expect(disabled.attempts).toEqual([])
  expect(JSON.stringify(disabled.traces)).toBe(original)
  const result = optimizePostRouting(input, phaseOptions())
  expect(result.status).toBe("rejected")
  expect(result.diagnostics).toContain(
    "No strict improvement under declared objective",
  )
  expect(result.changedNets).toEqual([])
  expect(result.before).toEqual(result.after)
  expect(JSON.stringify(result.traces)).toBe(original)
  expect(JSON.stringify(input.traces)).toBe(original)
})
