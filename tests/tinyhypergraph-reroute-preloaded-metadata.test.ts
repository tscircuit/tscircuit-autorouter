import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../lib/types"

test("full-connection rerouting preserves preloaded trace sections", () => {
  for (const input of [dataset01.circuit004, dataset01.circuit014]) {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(input) as SimpleRouteJson,
    )
    while (
      !solver.failed &&
      !solver.solved &&
      !solver.portPointPathingSolver?.solved
    ) {
      solver.step()
    }
    expect(solver.failed).toBe(false)
    expect(solver.portPointPathingSolver?.solved).toBe(true)
    expect(() => solver.portPointPathingSolver!.getOutput()).not.toThrow()
  }
})
