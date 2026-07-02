import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { solveAndSnapshot } from "./fixtures"
import scenario from "./srj/preexisting-connected-traces02.srj.json" with { type: "json" }

test(
  "Pipeline7 trace connectsTo suppresses two disjoint edges in a 4 point net",
  () => {
    const srj = structuredClone(scenario) as SimpleRouteJson

    const { outputSrj } = solveAndSnapshot(srj, import.meta.path, {
      problem: "A four-point net has two preexisting routed pairs: U1-R1 and R2-R3.",
      expected: "Pipeline7 should emit one bridge between the two already-routed groups.",
    })

    expect(outputSrj.traces).toHaveLength(1)
  },
  { timeout: 60_000 },
)
