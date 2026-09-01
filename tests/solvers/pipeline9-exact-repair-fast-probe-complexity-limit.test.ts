import { expect, test } from "bun:test"
import { shouldRunPipeline9ExactRepairFastProbe } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"

test("skips the fast probe when exact-repair work exceeds its budget", (): void => {
  expect(
    shouldRunPipeline9ExactRepairFastProbe({
      routeCount: 58,
      drcIssueCount: 22,
    }),
  ).toBe(false)
})
