import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 reports SRJ33 sample 17's unavoidable fixed-terminal clearance", async (): Promise<void> => {
  // Benchmark sample 17 is the dataset export named sample036.
  const { scenario } = await loadScenarioBySampleNumber("srj33", 17)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(
    solver.pipeline9JointDrcRepairSolver!.stats.terminalEscapeCandidateCount,
  ).toBe(0)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const { errors, circuitJson } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  })
  const trace = routedTraces.find(
    (trace) => trace.pcb_trace_id === "source_trace_24_0",
  )!
  const terminals = scenario.connections.find(
    (connection) => connection.name === "source_trace_24",
  )!.pointsToConnect
  for (const terminal of terminals) {
    expect([trace.route[0], trace.route.at(-1)]).toContainEqual(
      expect.objectContaining({
        route_type: "wire",
        x: terminal.x,
        y: terminal.y,
        layer: terminal.layer,
        width: scenario.minTraceWidth,
      }),
    )
  }
  const endpoint = trace.route.at(-1)!
  const foreignPad = circuitJson.find(
    (element) =>
      element.type === "pcb_smtpad" &&
      element.pcb_smtpad_id === "pcb_smtpad_38",
  )!
  if (
    endpoint.route_type !== "wire" ||
    foreignPad.type !== "pcb_smtpad" ||
    foreignPad.shape !== "rect"
  ) {
    throw new Error(
      "Expected the fixed wire endpoint and rectangular foreign pad",
    )
  }
  // Board-space millimetres: +X right, +Y up. The endpoint center lies to
  // the pad's left within its vertical span, so every approach retains this
  // round endcap gap. The old repair hid it by moving the terminal 0.519 mm.
  expect(endpoint.layer).toBe(foreignPad.layer)
  expect(endpoint.x).toBeLessThan(foreignPad.x - foreignPad.width / 2)
  expect(Math.abs(endpoint.y - foreignPad.y)).toBeLessThan(
    foreignPad.height / 2,
  )
  const maximumClearance =
    foreignPad.x - foreignPad.width / 2 - endpoint.x - endpoint.width / 2
  expect(maximumClearance).toBeCloseTo(0.0712243075, 9)
  expect(maximumClearance).toBeLessThan(0.1)
  expect(errors).toEqual([
    expect.objectContaining({
      type: "pcb_pad_trace_clearance_error",
      pcb_trace_id: trace.pcb_trace_id,
      pcb_pad_id: foreignPad.pcb_smtpad_id,
      minimum_clearance: 0.1,
      actual_clearance: expect.closeTo(maximumClearance, 9),
    }),
  ])
})
