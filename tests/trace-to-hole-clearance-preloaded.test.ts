import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import fixture from "./fixtures/hole-clearance/npth.srj.json"

test("shared DRC reports preloaded trace clearance and overlap with NPTHs", (): void => {
  for (const y of [1.1, 0]) {
    const srj = structuredClone(fixture) as SimpleRouteJson
    srj.minTraceToHoleEdgeClearance = 0.2
    srj.obstacles[2]!.isHole = true
    srj.obstacles[2]!.shape = "circle"
    srj.traces = [
      {
        type: "pcb_trace",
        pcb_trace_id: "saved_trace_too_close_to_hole",
        connection_name: "fixed_net",
        route: [
          { route_type: "wire", x: -2, y, width: 0.15, layer: "bottom" },
          { route_type: "wire", x: 2, y, width: 0.15, layer: "bottom" },
        ],
      },
    ]
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
      cacheProvider: null,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    const { errors } = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    })
    expect(errors).toContainEqual(
      expect.objectContaining({
        type: "pcb_trace_error",
        pcb_trace_id: "saved_trace_too_close_to_hole",
        message: expect.stringContaining(
          y === 1.1
            ? "gap: 0.025000mm, required: 0.2mm"
            : 'overlaps with pcb_hole "pcb_hole[#pcb_hole_2]"',
        ),
      }),
    )
  }
})
