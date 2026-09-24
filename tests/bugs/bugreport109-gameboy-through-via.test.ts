import { checkSourceTracesHavePcbTraces } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import board from "../../fixtures/bug-reports/bugreport109-gameboy-through-via/bugreport109-gameboy-through-via.srj.json" with {
  type: "json",
}

test("Pipeline9 routes the four-layer Game Boy while respecting through-via copper", async (): Promise<void> => {
  const inputSrj = structuredClone(board) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })

  expect(inputSrj.layerCount).toBe(4)
  expect(inputSrj.allowBlindAndBuriedVias).toBe(false)
  expect(inputSrj.connections).toHaveLength(144)
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
    includeBoardClearance: true,
    drcOptions: {
      traceClearance: inputSrj.minTraceToPadEdgeClearance,
    },
  }
  const { errors, circuitJson } = evaluateRelaxedDrc(drcInput)
  expect(checkSourceTracesHavePcbTraces(circuitJson)).toHaveLength(0)
  const vias = circuitJson.filter((element) => element.type === "pcb_via")
  expect(vias.length).toBeGreaterThan(0)
  for (const via of vias) {
    expect(via.layers).toEqual(["top", "inner1", "inner2", "bottom"])
  }

  // Keep the complete-board target strict: routing must preserve connectivity
  // and clear every DRC, including copper across the full through-via span.
  expect(errors).toHaveLength(0)

  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(snapshotPath)
})
