import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import inputJson from "./fixtures/manual-breakout-region.srj.json"

test("Pipeline9 mistakes breakout routing bounds for the board edge and adds two vias", async (): Promise<void> => {
  // Characterizes the regression introduced in capacity-autorouter 0.0.901.
  // See fixtures/manual-breakout-region.md for the release bisect and core source.
  const input = structuredClone(inputJson) as SimpleRouteJson
  const solver = new Pipeline(input, { cacheProvider: null })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const beforeRepair = solver.globalDrcForceImproveSolver!.getOutput()
  expect(beforeRepair.flatMap((route) => route.vias ?? [])).toHaveLength(0)
  const beforeTraces = beforeRepair.map((route, index) => ({
    type: "pcb_trace" as const,
    pcb_trace_id: `before_${index}`,
    connection_name: route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, input.layerCount),
  }))
  const beforeEvaluation = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: beforeTraces,
  }
  expect(evaluateRelaxedDrc(beforeEvaluation).errors).toHaveLength(0)
  const falseEdgeErrors = evaluateRelaxedDrc({
    ...beforeEvaluation,
    includeBoardClearance: true,
  }).errors
  expect(falseEdgeErrors).toHaveLength(1)
  expect(falseEdgeErrors[0]!.message).toContain("Trace too close to board edge")

  const traces = solver.getOutputSimplifiedPcbTraces()
  const vias = traces.flatMap((trace) =>
    trace.route.filter((point) => point.route_type === "via"),
  )
  expect(vias).toHaveLength(2)
  // The new signal via is only ~0.0434mm from the unrelated circular GND pad.
  // The relaxed checker does not report this clearance defect; core does.
  const padGap = Math.min(...vias.map((via) =>
    Math.hypot(via.x - (-2.5), via.y) - 0.15 - 0.25,
  ))
  expect(padGap).toBeCloseTo(0.04342259, 6)
  expect(padGap).toBeLessThan(input.minTraceToPadEdgeClearance!)

  const finalEvaluation = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: traces,
    includeBoardClearance: true,
  }
  const remainingErrors = evaluateRelaxedDrc(finalEvaluation).errors
  expect(remainingErrors).toHaveLength(1)
  expect(remainingErrors[0]!.message).toContain("Trace too close to board edge")

  // Keep the routing region unchanged; supply the actual 12x8mm board outline.
  const controlInput: SimpleRouteJson = {
    ...structuredClone(inputJson) as SimpleRouteJson,
    outline: [{ x: -6, y: -4 }, { x: 6, y: -4 }, { x: 6, y: 4 }, { x: -6, y: 4 }],
  }
  const control = new Pipeline(controlInput, { cacheProvider: null })
  control.solve()
  expect(control.solved).toBe(true)
  expect(control.failed).toBe(false)
  const controlTraces = control.getOutputSimplifiedPcbTraces()
  expect(controlTraces.flatMap((trace) =>
    trace.route.filter((point) => point.route_type === "via"),
  )).toHaveLength(0)
  const controlEvaluation = {
    inputSrj: controlInput,
    srjWithPointPairs: control.srjWithPointPairs!,
    routedTraces: controlTraces,
    includeBoardClearance: true,
  }
  expect(evaluateRelaxedDrc(controlEvaluation).errors).toHaveLength(0)

  await expect(getBugReportSnapshotSvg(finalEvaluation)).toMatchSvgSnapshot(import.meta.path, { svgName: "false-board-edge" })
  await expect(getBugReportSnapshotSvg(controlEvaluation)).toMatchSvgSnapshot(import.meta.path, { svgName: "physical-board-outline" })
})
