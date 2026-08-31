import { expect, test } from "bun:test"
import { shouldRunPipeline9ExactRepairFastProbe } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"

test("keeps the fast probe for small exact-repair problems", () => {
  expect(
    shouldRunPipeline9ExactRepairFastProbe({
      routeCount: 58,
      drcIssueCount: 8,
    }),
  ).toBe(true)
})
