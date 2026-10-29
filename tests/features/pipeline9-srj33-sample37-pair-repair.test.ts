import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 jointly repairs SRJ33 sample37 with fixed terminals and preload copper", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj33", 37)
  const input = structuredClone(scenario)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })
  while (
    !solver.pipeline9JointDrcRepairSolver &&
    !solver.solved &&
    !solver.failed
  ) {
    solver.step()
  }
  const joint = solver.pipeline9JointDrcRepairSolver!
  expect(joint).toBeDefined()
  const fixedCopper = structuredClone(joint.fixedPreloadedObstacleRoutes)
  const inputRoutes = structuredClone(joint.inputNewHdRoutes)
  while (!joint.regionalB01RepairSolver && !solver.solved && !solver.failed) {
    solver.step()
  }
  // Earlier exact repair may adjust explicitly movable preload sections.
  // The pair repair must retain the copper it receives from that stage.
  const preloadedTraces = structuredClone(joint.getUpdatedPreloadedTraces())
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toEqual([])
  expect(joint.fixedPreloadedObstacleRoutes).toEqual(fixedCopper)
  expect(joint.inputNewHdRoutes).toEqual(inputRoutes)
  expect(input).toEqual(scenario)
  expect(joint.getUpdatedPreloadedTraces()).toHaveLength(preloadedTraces.length)
  for (const preload of preloadedTraces) {
    const returned = joint.getUpdatedPreloadedTraces().find(
      (trace) => trace.pcb_trace_id === preload.pcb_trace_id,
    )!
    expect(returned.route).toEqual(preload.route)
  }
  // All original routed terminal anchors remain fixed, including the two
  // repaired connections source_net_3_mst1 and source_trace_58.
  for (const original of inputRoutes) {
    const name = original.connectionName
    const repaired = joint
      .getOutput()
      .find((route) => route.connectionName === name)!
    expect(repaired.route[0]).toEqual(original.route[0])
    expect(repaired.route.at(-1)).toEqual(original.route.at(-1))
    expect(repaired.traceThickness).toBeGreaterThanOrEqual(
      original.traceThickness,
    )
    expect(repaired.viaDiameter).toBeGreaterThanOrEqual(original.viaDiameter)
  }
  expect(joint.stats.regionalB01RepairRemainingDrcIssueCount).toBe(0)
  expect(
    joint.stats.regionalB01RepairCandidateSearchBudgetExhausted,
  ).toBeFalse()
})
