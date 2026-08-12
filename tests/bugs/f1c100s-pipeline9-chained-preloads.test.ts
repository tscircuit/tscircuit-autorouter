import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/bug-reports/f1c100s-pipeline9-chained-preloads/f1c100s-pipeline9-chained-preloads.srj.json" with {
  type: "json",
}

test("Pipeline9 consumes traces adapted by a previous Pipeline9 phase", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj) as SimpleRouteJson,
    {
      cacheProvider: null,
      effort: 1,
    },
  )

  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
})
