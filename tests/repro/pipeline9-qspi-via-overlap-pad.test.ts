import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "./assets/pipeline9-qspi-via-overlap-pad.json"

test(
  "Pipeline9 does not place via overlapping unrelated pad (repro #2654)",
  () => {
    const input = structuredClone(capturedInput) as SimpleRouteJson
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)

    const traces = solver.getOutputSimplifiedPcbTraces()

    // Check the reported failing pair: via on source_trace_30 vs pcb_smtpad_87
    const pad87 = input.obstacles.find(
      (o: any) => o.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_87",
    )!
    expect(pad87).toBeDefined()
    expect(pad87.connectedTo).toContain("source_trace_34")
    expect(pad87.connectedTo).not.toContain("source_trace_30")

    const violations: any[] = []
    for (const trace of traces.filter(
      (t: any) => t.connection_name === "source_trace_30",
    )) {
      for (const via of trace.route.filter(
        (
          p,
        ): p is Extract<(typeof trace.route)[number], { route_type: "via" }> =>
          p.route_type === "via" &&
          (p.from_layer === "top" || p.to_layer === "top"),
      )) {
        const dx = Math.max(
          Math.abs(via.x - pad87.center.x) - pad87.width / 2,
          0,
        )
        const dy = Math.max(
          Math.abs(via.y - pad87.center.y) - pad87.height / 2,
          0,
        )
        const gap =
          Math.hypot(dx, dy) -
          (via.via_diameter ?? input.minViaPadDiameter ?? 0.6) / 2
        const required = input.minViaEdgeToPadEdgeClearance ?? 0.25
        if (gap < required - 1e-9) {
          violations.push({
            trace: trace.connection_name,
            via,
            pad: pad87.circuitJsonMetadata,
            gap,
            required,
          })
        }
      }
    }

    expect(violations).toEqual([])
  },
  { timeout: 180_000 },
)
