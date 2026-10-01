import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { boardFixture, phaseOptions } from "../post-routing/fixtures"

test("independent forest phase runs without the tree stage and disabled output stays exact", () => {
  const input = boardFixture().srj
  const baseline = new Pipeline9(structuredClone(input), {
    effort: 0.1,
    cacheProvider: null,
  })
  baseline.solve()
  const disabled = new Pipeline9(structuredClone(input), {
    effort: 0.1,
    cacheProvider: null,
    postRoutingOptimization: { ...phaseOptions(), enabled: false },
  })
  disabled.solve()
  expect(disabled.pipelineDef.map((stage) => stage.solverName)).toEqual(
    baseline.pipelineDef.map((stage) => stage.solverName),
  )
  expect(JSON.stringify(disabled.getOutputSimpleRouteJson())).toBe(
    JSON.stringify(baseline.getOutputSimpleRouteJson()),
  )
  const options = phaseOptions()
  options.objective.maxBendIncrease = 4
  const forest = new Pipeline9(structuredClone(input), {
    effort: 0.1,
    cacheProvider: null,
    postRoutingOptimization: options,
  })
  forest.solve()
  expect(forest.solved).toBe(true)
  expect(
    forest.pipelineDef.some(
      (stage) => stage.solverName === "dynamicNetTreeSolver",
    ),
  ).toBe(false)
  expect(forest.pipelineDef.slice(-2).map((stage) => stage.solverName)).toEqual(
    ["postRoutingForestSolver", "postRoutingOptimizationSolver"],
  )
  expect(forest.postRoutingForestSolver!.iterations).toBeGreaterThan(1)
  const result = forest.getPostRoutingOptimizationResult()!
  expect(result.status).toBe("accepted")
  expect(result.attempts[0]!.stats.zeroViaForestJoins).toBeGreaterThan(0)
  expect(forest.getOutputSimpleRouteJson().traces).toEqual(result.traces)
  expect(forest.getOutputSimplifiedPcbTraces()).toEqual(result.traces)
})
