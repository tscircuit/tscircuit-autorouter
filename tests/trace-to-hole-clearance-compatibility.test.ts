import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import fixture from "./fixtures/hole-clearance/npth.srj.json"

test("hole clearance preserves legacy routing and does not identify arbitrary keepouts as holes", (): void => {
  for (const Solver of [
    AutoroutingPipelineSolver7_MultiGraph,
    AutoroutingPipelineSolver9_PreloadedTraceGraph,
  ]) {
    let baseline: SimplifiedPcbTraces | undefined
    for (const options of [
      { clearance: undefined, isHole: false },
      { clearance: undefined, isHole: true },
      { clearance: 0.5, isHole: false },
    ]) {
      const srj = structuredClone(fixture) as SimpleRouteJson
      srj.minTraceToHoleEdgeClearance = options.clearance
      srj.obstacles[2]!.isHole = options.isHole
      const solver = new Solver(srj, { cacheProvider: null })
      solver.solve()
      expect(solver.error).toBeNull()
      expect(solver.solved).toBe(true)
      const traces = solver.getOutputSimplifiedPcbTraces()
      if (baseline) expect(traces).toEqual(baseline)
      baseline = traces
    }
  }
})
