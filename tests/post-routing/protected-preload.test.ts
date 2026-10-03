import { expect, test } from "bun:test"
import { optimizePostRouting } from "lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { boardFixture, phaseOptions, wireTrace } from "./fixtures"

test("selected-net preloaded copper and earlier generated fixed-net branches retain exact geometry and identity", () => {
  const input = boardFixture()
  const fixed = wireTrace("dynamic:signal:0", "signal-pair", [
    [0, 0],
    [4, 0],
  ])
  input.srj.traces = [structuredClone(fixed)]
  input.traces.unshift(fixed)
  const original = structuredClone(input)
  const result = optimizePostRouting(input, phaseOptions())
  expect(result.status).toBe("accepted")
  expect(
    result.traces.filter((t) => t.pcb_trace_id === fixed.pcb_trace_id),
  ).toEqual([fixed])
  expect(new Set(result.traces.map((t) => t.pcb_trace_id)).size).toBe(
    result.traces.length,
  )
  expect(
    JSON.stringify(
      result.traces.find((t) => t.pcb_trace_id === "dynamic:fixed:0"),
    ),
  ).toBe(JSON.stringify(input.traces[2]))
  expect(result.changes[0]!.removedTraceIds).toEqual(["old-signal"])
  expect(input).toEqual(original)
})
