import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/bug-reports/via-in-pad-topology-overlap/via-in-pad-topology-overlap.srj.json" with {
  type: "json",
}

// A 6x6 0.8mm BGA with a same-net via drilled into the pad at (-0.4, -0.4).
test("repro: Pipeline9 fails topology merging on a via drilled into a BGA pad", (): void => {
  const srj = structuredClone(srjJson) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })

  expect(() => solver.solve()).toThrow(
    "have an unresolved inter-group overlap on a shared layer",
  )
  expect(solver.failed).toBe(true)
})
