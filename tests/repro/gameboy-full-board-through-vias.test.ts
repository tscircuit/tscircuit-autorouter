import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "./assets/gameboy-full-board-through-vias.srj.json"

test("Pipeline9 routes the full Game Boy and reports final DRCs", async (): Promise<void> => {
  // Captured from Core 0.0.1989's autorouting:start event before any routing.
  const inputSrj = structuredClone(simpleRouteJson) as SimpleRouteJson
  expect(inputSrj.layerCount).toBe(4)
  expect(inputSrj.allowBlindAndBuriedVias).toBeFalse()
  expect(inputSrj.connections).toHaveLength(144)
  expect(inputSrj.obstacles).toHaveLength(477)
  expect(inputSrj.traces).toBeUndefined()

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
    effort: 1,
  })
  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()

  const drcInput = {
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
  const { circuitJson, errors } = evaluateRelaxedDrc(drcInput)
  const errorsByType: Record<string, number> = {}
  for (const error of errors) {
    errorsByType[error.type] = (errorsByType[error.type] ?? 0) + 1
  }
  console.log("Full Game Boy DRC result", {
    platform: process.platform,
    traces: drcInput.routedTraces.length,
    vias: circuitJson.filter((element) => element.type === "pcb_via").length,
    drcErrors: errors.length,
    errorsByType,
  })

  // This captures the measured DRC count, not an assertion of DRC-free routing.
  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
