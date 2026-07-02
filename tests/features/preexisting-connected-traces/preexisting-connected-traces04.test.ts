import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { solveAndSnapshot } from "./fixtures"
import scenario from "./srj/preexisting-connected-traces04.srj.json" with { type: "json" }

test(
  "Pipeline7 ignores trace connectsTo entries that do not form a point pair",
  () => {
    const srj = structuredClone(scenario) as SimpleRouteJson

    const { outputSrj } = solveAndSnapshot(srj, import.meta.path, {
      problem: "A physical preexisting route is present but connectsTo declares only one endpoint.",
      expected: "Pipeline7 should ignore that trace for MST suppression and emit two traces.",
    })

    expect(outputSrj.traces).toHaveLength(2)
  },
  { timeout: 60_000 },
)
