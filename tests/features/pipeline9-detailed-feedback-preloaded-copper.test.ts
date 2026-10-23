import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import type { SimplifiedPcbTrace } from "../../lib/types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("full-pipeline feedback replan preserves every section of original preloaded copper exactly once", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 9)
  const input = structuredClone(scenario)
  const preload: SimplifiedPcbTrace = {
    type: "pcb_trace", pcb_trace_id: "feedback-preload", connection_name: "feedback-preload",
    connectsTo: ["feedback-preload-start", "feedback-preload-end"],
    route: [-10, -5, 0].map((x) => ({ route_type: "wire", x, y: 20.5, layer: "bottom", width: 0.1 })),
  }
  input.traces = [preload]
  input.connections.push({
    name: "feedback-preload",
    pointsToConnect: [
      { x: -10, y: 20.5, layer: "bottom", pointId: "feedback-preload-start", pcb_port_id: "feedback-preload-start" },
      { x: 0, y: 20.5, layer: "bottom", pointId: "feedback-preload-end", pcb_port_id: "feedback-preload-end" },
    ],
  })
  const before = structuredClone(preload)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null, effort: 1 })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.detailedRoutingFeedback.stats.detailedFeedbackReplanCount).toBeGreaterThan(0)
  expect(solver.detailedRoutingFeedback.stats.detailedFeedbackEarlyReplanCount).toBeGreaterThan(0)
  expect(solver.detailedRoutingRounds.filter((round) => round.status === "refined")
    .every((round) => round.failedAttemptCount > 0)).toBe(true)
  const output = solver.getOutputSimpleRouteJson().traces!
  const preserved = output.filter((trace) => trace.pcb_trace_id === preload.pcb_trace_id)
  expect(preserved).toHaveLength(1)
  expect(preserved[0]!.route).toEqual(before.route)
  expect(preserved[0]!.connectsTo).toEqual(before.connectsTo)
  expect(new Set(output.map((trace) => trace.pcb_trace_id)).size).toBe(output.length)
  expect(preload).toEqual(before)
  expect(solver.highDensityRouteSolver!.getUpdatedFixedHdRoutes().length).toBeGreaterThan(0)
  const drc = evaluateRelaxedDrc({
    inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(drc.errors).toEqual([])
})
