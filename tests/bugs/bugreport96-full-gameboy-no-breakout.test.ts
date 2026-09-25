import { checkSourceTracesHavePcbTraces } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import board from "../../fixtures/bug-reports/bugreport96-full-gameboy-no-breakout/bugreport96-full-gameboy-no-breakout.srj.json" with {
  type: "json",
}

test("Pipeline9 full Game Boy through-via DRC reproduction", async (): Promise<void> => {
  const inputSrj = structuredClone(board) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })

  expect(inputSrj.layerCount).toBe(4)
  expect(inputSrj.allowBlindAndBuriedVias).toBe(false)
  expect(inputSrj.connections).toHaveLength(144)
  expect(inputSrj.obstacles).toHaveLength(477)
  expect(inputSrj.traces ?? []).toHaveLength(0)

  solver.solve()

  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)
  expect(
    new Set(solver._getOutputHdRoutes().map((route) => route.connectionName)),
  ).toEqual(
    new Set(
      solver.srjWithPointPairs!.connections.map(
        (connection) => connection.name,
      ),
    ),
  )

  const drcInput = {
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
  const { circuitJson, errors } = evaluateRelaxedDrc(drcInput)
  expect(checkSourceTracesHavePcbTraces(circuitJson)).toHaveLength(0)

  console.info("Game Boy routing result", {
    pointPairs: solver.srjWithPointPairs!.connections.length,
    traces: drcInput.routedTraces.length,
    vias: circuitJson.filter((element) => element.type === "pcb_via").length,
    drcErrors: errors.length,
    drcErrorsByType: Object.fromEntries(
      [...new Set(errors.map((error) => error.type))].map((type) => [
        type,
        errors.filter((error) => error.type === type).length,
      ]),
    ),
  })

  // Record the current DRC failures, not a fabrication-ready result. The native
  // snapshot calculates its error count from this solve, so fixes change it.
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    snapshotPath,
    { svgName: "routed" },
  )
})
