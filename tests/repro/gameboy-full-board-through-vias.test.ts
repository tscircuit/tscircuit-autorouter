import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  type SimpleRouteJson as RepairSimpleRouteJson,
  type SimplifiedPcbTraces as RepairSimplifiedPcbTraces,
} from "high-density-repair03/lib"
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
  // Recheck identical copper with blind vias allowed to isolate contacts
  // caused by a through-via extending beyond its signal-layer transition.
  const blindInput = { ...inputSrj, allowBlindAndBuriedVias: true }
  const blindPairs = {
    ...drcInput.srjWithPointPairs,
    allowBlindAndBuriedVias: true,
  }
  const blindErrors = evaluateRelaxedDrc({
    ...drcInput,
    inputSrj: blindInput,
    srjWithPointPairs: blindPairs,
  }).errors
  const blindErrorIds = new Set(
    blindErrors
      .filter((error) => error.type === "pcb_trace_error")
      .map((error) => error.pcb_trace_error_id),
  )
  expect(
    drcInput.routedTraces.every((trace) =>
      trace.route.every(
        (point) => point.route_type === "wire" || point.route_type === "via",
      ),
    ),
  ).toBeTrue()
  const indexed = new AutoroutingDrcEngine(
    drcInput.srjWithPointPairs as RepairSimpleRouteJson,
  ).evaluate(drcInput.routedTraces as RepairSimplifiedPcbTraces)
  const indexedErrorIds = new Set(
    indexed.errors.map((error) => error.pcb_trace_error_id),
  )
  const missedThroughViaShorts = errors.filter(
    (error) =>
      error.type === "pcb_trace_error" &&
      error.message.includes("overlaps with pcb_via") &&
      error.message.includes("accidental contact") &&
      !blindErrorIds.has(error.pcb_trace_error_id) &&
      !indexedErrorIds.has(error.pcb_trace_error_id),
  )
  const errorsByType: Record<string, number> = {}
  for (const error of errors) {
    errorsByType[error.type] = (errorsByType[error.type] ?? 0) + 1
  }
  console.log("Full Game Boy DRC result", {
    platform: process.platform,
    traces: drcInput.routedTraces.length,
    vias: circuitJson.filter((element) => element.type === "pcb_via").length,
    drcErrors: errors.length,
    missedThroughViaShorts: missedThroughViaShorts.length,
    errorsByType,
  })

  // This captures the measured DRC count, not an assertion of DRC-free routing.
  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    import.meta.path,
  )

  // Known bug: Repair03 misses actual shorts outside a via's signal layers.
  // A future via-span fix must update this characterization assertion.
  expect(missedThroughViaShorts.length).toBeGreaterThan(0)
})
