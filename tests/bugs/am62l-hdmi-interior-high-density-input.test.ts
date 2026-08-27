import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"
import boardPhase from "../../fixtures/bug-reports/am62l-hdmi-phase3-fallback/am62l-hdmi-phase3.srj.json" with {
  type: "json",
}
import { getAm62lHdmiRouteVisualization } from "../fixtures/am62l-hdmi-phase-visualization"

test("repro: disconnected AM62L fanout copper prevents HDMI routing", async () => {
  const inputSrj = structuredClone(boardPhase) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
    visualizationTraceColorMode: "net",
  })

  solver.solve()

  expect(inputSrj.connections).toHaveLength(8)
  expect(inputSrj.traces).toHaveLength(48)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain(
    "Pipeline9 primary high-density routing failed",
  )

  await expect(
    getAm62lHdmiRouteVisualization({
      inputSrj,
      traces: inputSrj.traces ?? [],
      status: "unrouted",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
