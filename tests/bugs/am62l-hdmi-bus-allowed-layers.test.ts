import { expect, test } from "bun:test"
import boardPhase from "../../fixtures/bug-reports/am62l-hdmi-bus-constraints/am62l-hdmi-clock-pair.srj.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 rejects forbidden bus layers introduced after path search", (): void => {
  const inputSrj = structuredClone(boardPhase) as SimpleRouteJson
  expect(inputSrj.buses?.[0]?.allowedLayers).toEqual(["top"])
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })

  // Regional high-density repair currently moves these top-only wires onto
  // inner layers. The pipeline must reject that output instead of reporting success.
  expect(() => solver.solve()).toThrow(
    /Connection "source_trace_3[01]" routed wire on forbidden bus layer "inner[12]"/,
  )
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
})
