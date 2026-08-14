import { expect, test } from "bun:test"
import { Pipeline7AdaptiveGlobalDrcSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/Pipeline7AdaptiveGlobalDrcSolver"

test("Pipeline7 stops DRC repair after a step finds no improving candidate", () => {
  const solver = new Pipeline7AdaptiveGlobalDrcSolver({
    srj: {
      layerCount: 2,
      minTraceWidth: 0.15,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      obstacles: [],
      connections: [],
    },
    hdRoutes: [],
    drcEvaluator: () => [
      {
        type: "unrepairable_test_error",
        center: { x: 0.5, y: 0.5 },
      },
    ],
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })

  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.stats.adaptiveDrcStopReason).toBe("no_improving_candidate")
  expect(solver.stats.adaptiveDrcIssueCountAtStop).toBe(1)
})
