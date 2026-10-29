import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("a zero regional search budget preserves routes with scattered errors", () => {
  const routes: HighDensityRoute[] = []
  const solver = new Pipeline9BoundedRegionalRepairSolver({
    originalSrj: {
      bounds: { minX: -30, maxX: 30, minY: -5, maxY: 5 },
      layerCount: 2,
      minTraceWidth: 0.1,
      obstacles: [],
      connections: [],
    },
    routes,
    syntheticConnectionNames: new Set(),
    budget: {
      maxRegions: 0,
      maxCandidateAttempts: 0,
      maxPathSearchNodes: 0,
    },
    drcEvaluator: () => [
      { type: "pcb_trace_error", center: { x: -20, y: 0 } },
      { type: "pcb_trace_error", center: { x: 20, y: 0 } },
    ],
  })
  while (!solver.solved && !solver.failed) solver.step()
  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const result = solver.getResult()
  expect(result.routes).toBe(routes)
  expect(result.repaired).toBe(false)
  expect(result.publishedDrcIssueCount).toBe(2)
  expect(result.attemptedRegionCount).toBe(0)
  expect(result.candidateAttemptCount).toBe(0)
  expect(result.pathSearchNodeCount).toBe(0)
})
