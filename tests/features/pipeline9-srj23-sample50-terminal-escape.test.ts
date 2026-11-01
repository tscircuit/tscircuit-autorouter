import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 preserves an SRJ23 terminal whose center has unavoidable copper contact", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 50)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats.postExactReferenceAccepted,
  ).toBeFalse()
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats.terminalEscapeAcceptedCount,
  ).toBe(0)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const { errors, circuitJson } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  })
  const trace = routedTraces.find(
    (trace) => trace.pcb_trace_id === "source_net_5_mst0_0_routed",
  )!
  const terminals = scenario.connections
    .flatMap((connection) => connection.pointsToConnect)
    .filter((point) => trace.connectsTo?.includes(point.pcb_port_id!))
  expect(terminals).toHaveLength(2)
  for (const terminal of terminals) {
    expect([trace.route[0], trace.route.at(-1)]).toContainEqual(
      expect.objectContaining({
        x: terminal.x,
        y: terminal.y,
        layer: terminal.layer,
      }),
    )
  }
  const endpoint = trace.route.at(-1)!
  const foreignPad = circuitJson.find(
    (element) =>
      element.type === "pcb_plated_hole" &&
      element.pcb_plated_hole_id === "pcb_plated_hole_11",
  )!
  if (
    endpoint.route_type !== "wire" ||
    foreignPad.type !== "pcb_plated_hole" ||
    foreignPad.shape !== "circle"
  ) {
    throw new Error("Expected the fixed wire endpoint and circular foreign pad")
  }
  // Even a trace approaching from the opposite direction overlaps here: its
  // fixed center is closer than the sum of the pad and endcap copper radii.
  const centerDistance = Math.hypot(
    endpoint.x - foreignPad.x,
    endpoint.y - foreignPad.y,
  )
  expect(centerDistance).toBeLessThan(
    foreignPad.outer_diameter / 2 + endpoint.width / 2,
  )
  expect(errors).toEqual([
    expect.objectContaining({
      pcb_trace_error_id:
        "overlap_source_net_5_mst0_0_routed_pcb_plated_hole_11",
    }),
  ])
})
