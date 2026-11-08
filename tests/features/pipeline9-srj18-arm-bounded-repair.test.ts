import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { getPipeline9BoundedRepairBudget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"

test("SRJ18 sample 14 retains enough earned work for the exact ARM64 route geometry", (): void => {
  // Full native inputs captured by the ARM64 benchmark; do not round coordinates.
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/srj18-arm-bounded-repair.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const joint = new Pipeline9JointDrcRepairSolver({
    ...fixture.joint,
    connMap: new ConnectivityMap(fixture.joint.connMap),
    mutatedPreloadedTraceIds: new Set(fixture.joint.mutatedPreloadedTraceIds),
  })
  const solver = new Pipeline9BoundedRegionalRepairSolver({
    ...fixture.bounded,
    connMap: new ConnectivityMap(fixture.bounded.connMap),
    syntheticConnectionNames: new Set(fixture.bounded.syntheticConnectionNames),
    drcEvaluator: joint["cachedReferenceDrcEvaluator"]!,
    budget: getPipeline9BoundedRepairBudget(
      fixture.bounded.routes.length,
      439,
      1,
    ),
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  const result = solver.getResult()
  expect(result.initialDrcIssueCount).toBe(439)
  expect(result.finalDrcIssueCount).toBe(0)
  expect(result.repaired).toBe(true)
  expect(result.candidateAttemptCount).toBeLessThanOrEqual(8192)
})
