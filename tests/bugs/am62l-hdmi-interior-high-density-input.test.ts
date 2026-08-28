import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"
import boardPhase from "../../fixtures/bug-reports/am62l-hdmi-phase3-fallback/am62l-hdmi-phase3.srj.json" with {
  type: "json",
}
import { getAm62lHdmiRouteVisualization } from "../fixtures/am62l-hdmi-phase-visualization"

test("AM62L fanout copper remains connected to the routed HDMI nets", async () => {
  const inputSrj = structuredClone(boardPhase) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
    visualizationTraceColorMode: "net",
  })

  solver.solve()

  expect(inputSrj.connections).toHaveLength(8)
  expect(inputSrj.traces).toHaveLength(48)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const routedTraces = solver.getOutputSimpleRouteJson().traces ?? []
  const preloadedTraceIds = new Set(
    inputSrj.traces?.map((trace) => trace.pcb_trace_id),
  )
  const newHdmiTraces = routedTraces.filter(
    (trace) => !preloadedTraceIds.has(trace.pcb_trace_id),
  )
  expect(routedTraces).toHaveLength(64)
  expect(newHdmiTraces).toHaveLength(16)
  for (const connection of inputSrj.connections) {
    expect(
      newHdmiTraces.filter(
        (trace) => trace.connection_name === connection.name,
      ),
    ).toHaveLength(2)
  }

  await expect(
    getAm62lHdmiRouteVisualization({
      inputSrj,
      traces: routedTraces,
      status: "routed",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
