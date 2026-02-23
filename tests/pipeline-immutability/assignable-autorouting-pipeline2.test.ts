import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport29-7deae8/bugreport29-7deae8.json" with {
  type: "json",
}

test(
  "AssignableAutoroutingPipeline2 solves and does not mutate input SRJ",
  () => {
    const srj = structuredClone(bugReport.simple_route_json as SimpleRouteJson)
    const before = structuredClone(srj)

    const solver = new AssignableAutoroutingPipeline2(srj)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(srj).toEqual(before)
  },
  { timeout: 180_000 },
)
