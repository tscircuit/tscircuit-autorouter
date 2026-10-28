import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import fixture from "../fixtures/via-in-pad/bga-same-net-via-in-pad.srj.json"

// A 6x6 0.8mm BGA with a via drilled into the pad at (-0.4, -0.4). The pad
// (top) and the via (all layers) overlap on top and share the pad's net.
test("pipeline 9 routes a BGA ball with a same-net via in its pad", (): void => {
  const srj = structuredClone(fixture) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.getOutputSimplifiedPcbTraces()).toHaveLength(1)
})
