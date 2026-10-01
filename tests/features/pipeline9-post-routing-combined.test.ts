import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { boardFixture, phaseOptions } from "../post-routing/fixtures"

test("a rejected forest transaction retains the accepted tree board in both output getters", () => {
  const input = boardFixture().srj,
    tree = phaseOptions(),
    forest = phaseOptions()
  tree.nets.forEach((plan) => delete plan.componentPlanning)
  tree.objective.maxBendIncrease = 4
  forest.objective.maxChangedNets = 0
  const solver = new Pipeline9(structuredClone(input), {
    effort: 0.1,
    cacheProvider: null,
    dynamicNetTreeRouting: tree,
    postRoutingOptimization: forest,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const a = solver.getDynamicNetTreeRoutingResult()!,
    b = solver.getPostRoutingOptimizationResult()!
  expect(a.status).toBe("accepted")
  expect(b.status).toBe("rejected")
  expect(b.before).toEqual(a.after)
  expect(b.traces).toEqual(a.traces)
  expect(solver.getOutputSimpleRouteJson().traces).toEqual(a.traces)
  expect(solver.getOutputSimplifiedPcbTraces()).toEqual(a.traces)
  expect(solver.pipelineDef.slice(-4).map((stage) => stage.solverName)).toEqual(
    [
      "dynamicNetTreeSolver",
      "dynamicNetTreeValidationSolver",
      "postRoutingForestSolver",
      "postRoutingOptimizationSolver",
    ],
  )
  expect(
    solver.postRoutingOptimizationSolver!.visualize().texts![0]!.text,
  ).toContain("Atomic rollback")
})
