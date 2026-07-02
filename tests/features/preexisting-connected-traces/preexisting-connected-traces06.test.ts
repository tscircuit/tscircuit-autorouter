import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { solveAndSnapshot } from "./fixtures"
import scenario from "./srj/preexisting-connected-traces06.srj.json" with { type: "json" }

test(
  "Pipeline7 can finish a trace when the start point is within a connected preexisting trace",
  () => {
    const srj = structuredClone(scenario) as SimpleRouteJson

    const { outputSrj } = solveAndSnapshot(srj, import.meta.path, {
      problem: "A preexisting escape trace passes through U1 pin1 but stops before reaching R1 pin1.",
      expected: "Pipeline7 should emit one new trace that finishes the route to the 0603 pad.",
    })

    expect(outputSrj.traces).toHaveLength(1)
  },
  { timeout: 60_000 },
)
