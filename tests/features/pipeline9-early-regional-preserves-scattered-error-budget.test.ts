import { expect, test } from "bun:test"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("the early regional pass preserves search work for scattered errors", () => {
  const routes: HighDensityRoute[] = []
  const result = applyPipeline9BoundedRegionalRepairs({
    originalSrj: {
      bounds: { minX: -30, maxX: 30, minY: -5, maxY: 5 },
      layerCount: 2,
      minTraceWidth: 0.1,
      obstacles: [],
      connections: [],
    },
    routes,
    syntheticConnectionNames: new Set(),
    requireSingleRegion: true,
    budget: {
      maxRegions: 1,
      maxCandidateAttempts: 256,
      maxPathSearchNodes: 120_000,
    },
    drcEvaluator: () => [
      { type: "pcb_trace_error", center: { x: -20, y: 0 } },
      { type: "pcb_trace_error", center: { x: 20, y: 0 } },
    ],
  })
  expect(result.routes).toBe(routes)
  expect(result.repaired).toBe(false)
  expect(result.publishedDrcIssueCount).toBe(2)
  expect(result.attemptedRegionCount).toBe(0)
  expect(result.candidateAttemptCount).toBe(0)
  expect(result.pathSearchNodeCount).toBe(0)
})
