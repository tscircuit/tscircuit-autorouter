import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import fixture from "./fixtures/hole-clearance/npth.srj.json"

test("a saved trace violating NPTH clearance cannot be reported as solved", (): void => {
  for (const Solver of [
    AutoroutingPipelineSolver7_MultiGraph,
    AutoroutingPipelineSolver9_PreloadedTraceGraph,
  ]) {
    const srj = structuredClone(fixture) as SimpleRouteJson
    srj.minTraceToHoleClearance = 0.2
    srj.obstacles[2]!.isHole = true
    srj.obstacles[2]!.shape = "circle"
    srj.traces = [
      {
        type: "pcb_trace",
        pcb_trace_id: "saved_trace_too_close_to_hole",
        connection_name: "fixed_net",
        route: [
          { route_type: "wire", x: -2, y: 1.1, width: 0.15, layer: "bottom" },
          { route_type: "wire", x: 2, y: 1.1, width: 0.15, layer: "bottom" },
        ],
      },
    ]
    const solver = new Solver(srj, { cacheProvider: null })
    solver.solve()
    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(true)
    expect(solver.error).toContain("saved_trace_too_close_to_hole")
    expect(solver.error).toContain("0.025000 mm")
    expect(solver.error).toContain("minTraceToHoleClearance requires 0.2 mm")
    expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow()
  }
})
