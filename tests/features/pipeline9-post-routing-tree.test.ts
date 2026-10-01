import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { boardFixture, phaseOptions } from "../post-routing/fixtures"

test("Pipeline9 calls the opt-in tree proposal and gate while default, disabled and rollback output stay identical", () => {
  const srj = boardFixture().srj,
    original = structuredClone(srj)
  const settings = phaseOptions()
  settings.nets.forEach((plan) => delete plan.componentPlanning)
  const baseline = new Pipeline9(structuredClone(srj), {
    effort: 0.1,
    cacheProvider: null,
  })
  baseline.solve()
  expect(baseline.solved).toBe(true)
  const serialized = JSON.stringify(baseline.getOutputSimpleRouteJson())
  const disabled = new Pipeline9(structuredClone(srj), {
    effort: 0.1,
    cacheProvider: null,
    dynamicNetTreeRouting: { ...settings, enabled: false },
  })
  disabled.solve()
  expect(disabled.pipelineDef.map((stage) => stage.solverName)).toEqual(
    baseline.pipelineDef.map((stage) => stage.solverName),
  )
  expect(JSON.stringify(disabled.getOutputSimpleRouteJson())).toBe(serialized)
  const rollback = new Pipeline9(structuredClone(srj), {
    effort: 0.1,
    cacheProvider: null,
    dynamicNetTreeRouting: settings,
  })
  rollback.solve()
  expect(rollback.solved).toBe(true)
  expect(rollback.getPostRoutingOptimizationResult()!.status).toBe("rejected")
  expect(JSON.stringify(rollback.getOutputSimpleRouteJson())).toBe(serialized)
  expect(rollback.getOutputSimplifiedPcbTraces()).toEqual(
    baseline.getOutputSimplifiedPcbTraces(),
  )
  expect(rollback.dynamicNetTreeSolver!.iterations).toBeGreaterThan(1)
  expect(rollback.dynamicNetTreeValidationSolver!.stats.status).toBe("rejected")
  expect(rollback.timeSpentOnPhase.dynamicNetTreeSolver).toBeGreaterThan(0)
  const optimized = new Pipeline9(structuredClone(srj), {
    effort: 0.1,
    cacheProvider: null,
    dynamicNetTreeRouting: {
      ...settings,
      objective: { ...settings.objective, maxBendIncrease: 4 },
    },
  })
  optimized.solve()
  const result = optimized.getPostRoutingOptimizationResult()!
  expect(result.status).toBe("accepted")
  expect(result.changedNets).toEqual(["signal"])
  expect(result.after!.copperLength).toBeLessThan(result.before!.copperLength)
  expect(optimized.getOutputSimpleRouteJson().traces).toEqual(result.traces)
  expect(optimized.getOutputSimplifiedPcbTraces()).toEqual(result.traces)
  expect(
    result.traces.find((trace) => trace.connection_name === "fixed"),
  ).toEqual(
    baseline
      .getOutputSimpleRouteJson()
      .traces!.find((trace) => trace.connection_name === "fixed"),
  )
  expect(srj).toEqual(original)
})
