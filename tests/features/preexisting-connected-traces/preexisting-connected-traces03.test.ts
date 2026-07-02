import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { solveAndSnapshot } from "./fixtures"
import scenario from "./srj/preexisting-connected-traces03.srj.json" with { type: "json" }

test(
  "Pipeline7 trace connectsTo can mark an entire 3 point net already routed",
  () => {
    const srj = structuredClone(scenario) as SimpleRouteJson

    const { outputSrj } = solveAndSnapshot(srj, import.meta.path, {
      problem: "The preexisting trace declares all three points on the net as connected.",
      expected: "Pipeline7 should emit no new traces for this fully routed net.",
    })

    expect(outputSrj.traces).toHaveLength(0)
  },
  { timeout: 60_000 },
)
