import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { solveAndSnapshot } from "./fixtures"
import scenario from "./srj/preexisting-connected-traces01.srj.json" with { type: "json" }

test(
  "Pipeline7 trace connectsTo suppresses one edge in a 3 point net",
  () => {
    const srj = structuredClone(scenario) as SimpleRouteJson

    const { outputSrj } = solveAndSnapshot(srj, import.meta.path, {
      problem: "U1 pin1, R1 pin1, and R2 pin1 share a net; U1 pin1 to R1 pin1 is already routed.",
      expected: "Pipeline7 should emit only the missing R2 connection.",
    })

    expect(outputSrj.traces).toHaveLength(1)
  },
  { timeout: 60_000 },
)
