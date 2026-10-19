import { expect, test } from "bun:test"
import { checkViasInPads } from "@tscircuit/checks"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "../../fixtures/bug-reports/luma-led-power-phase/luma-led-power-phase.srj.json" with { type: "json" }

test("Luma power phase reports solved while introducing via-in-pad violations", async (): Promise<void> => {
  const input = structuredClone(capturedInput) as SimpleRouteJson
  expect(input.layerCount).toBe(2)
  expect(input.connections).toHaveLength(4)
  expect(input.obstacles).toHaveLength(97)
  expect(input.traces).toHaveLength(12)
  expect(input.outline).toHaveLength(180)
  expect(input.minTraceToPadEdgeClearance).toBe(0.2)

  const drcOptions = {
    traceClearance: input.minTraceToPadEdgeClearance,
    viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance,
  }
  const before = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: input,
    routedTraces: [],
    drcOptions,
  })
  expect(before.errors).toEqual([])
  expect(checkViasInPads(before.circuitJson)).toEqual([])

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(input),
    { cacheProvider: null, effort: 1 },
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()

  const snapshotInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    drcOptions,
  }
  expect(snapshotInput.routedTraces.length).toBeGreaterThan(0)
  const after = evaluateRelaxedDrc(snapshotInput)
  // Repro-only characterization: a fix should reverse these two assertions.
  expect(after.errors.length).toBeGreaterThan(before.errors.length)
  expect(checkViasInPads(after.circuitJson).length).toBeGreaterThan(0)
  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
