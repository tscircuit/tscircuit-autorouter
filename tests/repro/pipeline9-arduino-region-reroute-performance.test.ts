import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"
import capturedArduinoRegionReroute from "./assets/pipeline9-arduino-region-reroute.srj.json" with {
  type: "json",
}

const EXPECTED_OUTPUT_TRACES_SHA256 =
  "9e033c09c881bf806770a7b83585dbfcc6e8569cf3357c4e09f5b276b5df8b67"

test("Pipeline9 records repeated reference DRC work for an Arduino region reroute", () => {
  const input = structuredClone(
    capturedArduinoRegionReroute,
  ) as unknown as SimpleRouteJson
  expect(input.connections).toHaveLength(4)
  expect(input.obstacles).toHaveLength(343)
  expect(input.traces).toHaveLength(210)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const outputTraces = solver.getOutputSimpleRouteJson().traces ?? []
  expect(outputTraces).toHaveLength(214)
  expect(
    createHash("sha256")
      .update(JSON.stringify(outputTraces))
      .digest("hex"),
  ).toBe(EXPECTED_OUTPUT_TRACES_SHA256)

  // Captured from core's repro116 region (8..18 mm). On the original board,
  // Pipeline9 took about 15 s versus Pipeline7's 4.2 s. The indexed DRC sees
  // no issue, but reference DRC repeatedly reports the eight intentional
  // boundary joins as disconnected while the exact-repair portfolio explores
  // candidates. This deterministic count exposes the cost without a flaky
  // wall-clock assertion.
  const jointDrcStats = solver.pipeline9JointDrcRepairSolver?.stats
  expect(jointDrcStats).toMatchObject({
    initialJointDrcIssueCount: 8,
    globalDrcForceImproveCandidateAttempts: 12,
    regionalB01RepairCandidateCount: 0,
    referenceDrcValidationCount: 61,
    referenceDrcFalseNegativeCount: 61,
  })
})
