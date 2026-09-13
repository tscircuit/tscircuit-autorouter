import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "../../fixtures/bug-reports/bugreport106-gba-clock-bus-layer-restrictions/bugreport106-gba-clock-bus-layer-restrictions.srj.json" with {
  type: "json",
}

test("Pipeline9 native Game Boy clock bus layer restrictions", async (): Promise<void> => {
  // Untouched native first-phase input, not captured output or authored copper.
  const input = structuredClone(capturedInput) as SimpleRouteJson
  expect(input.layerCount).toBe(2)
  expect(input.allowBlindAndBuriedVias).toBe(false)
  expect(input.connections).toHaveLength(32)
  expect(input.obstacles).toHaveLength(452)
  expect(input.traces).toEqual([])
  const buses = input.buses
  if (!buses) {
    throw new Error("The native input must retain its clock bus declarations")
  }
  expect(buses).toHaveLength(5)
  for (const bus of buses) {
    expect(bus.allowedLayers).toEqual(["top"])
  }

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(routedTraces.length).toBeGreaterThan(0)
  const srjWithPointPairs = solver.srjWithPointPairs
  if (!srjWithPointPairs) {
    throw new Error("The first-phase solver did not produce point-paired SRJ")
  }

  // Observe native output; do not assert that the current forbidden vias persist.
  // The snapshot evaluator is not a complete Core/fabrication or bus-layer gate.
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs,
      routedTraces,
      drcOptions: { traceClearance: input.minTraceToPadEdgeClearance },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
