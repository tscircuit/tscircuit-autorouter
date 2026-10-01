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

test("a rejected tree proposal still executes B on the preserved valid baseline", () => {
  const input = boardFixture().srj,
    tree = phaseOptions(),
    forest = phaseOptions()
  tree.nets.forEach((plan) => delete plan.componentPlanning)
  tree.objective.maxChangedNets = 0
  forest.objective.maxBendIncrease = 4
  const solver = new Pipeline9(structuredClone(input), {
    effort: 0.1,
    cacheProvider: null,
    dynamicNetTreeRouting: tree,
    postRoutingOptimization: forest,
  })
  solver.solve()
  const a = solver.getDynamicNetTreeRoutingResult()!,
    b = solver.getPostRoutingOptimizationResult()!
  expect(a.status).toBe("rejected")
  expect(a.validationStatus).toBe("validated")
  expect(b.validationStatus).toBe("validated")
  expect(b.attempts.length).toBeGreaterThan(0)
  expect(b.before).toEqual(a.after)
  expect(solver.getOutputSimplifiedPcbTraces()).toEqual(b.traces)
})

test("unsupported A preserves copper and still reports B independently without claiming validation", () => {
  const input = boardFixture().srj
  input.obstacles[0]!.layers = ["top", "bottom"]
  const solver = new Pipeline9(structuredClone(input), {
    effort: 0.1,
    cacheProvider: null,
    dynamicNetTreeRouting: {
      ...phaseOptions(),
      nets: phaseOptions().nets.map(({ componentPlanning, ...plan }) => plan),
    },
    postRoutingOptimization: phaseOptions(),
  })
  solver.solve()
  const a = solver.getDynamicNetTreeRoutingResult()!,
    b = solver.getPostRoutingOptimizationResult()!
  expect(solver.solved).toBe(true)
  expect(a.status).toBe("unsupported")
  expect(b.status).toBe("unsupported")
  expect(a.validationStatus).toBe("unsupported")
  expect(b.validationStatus).toBe("unsupported")
  expect(a.traces).toEqual(b.traces)
  expect(a.attempts).toEqual([])
  expect(b.attempts).toEqual([])
  expect(solver.getOutputSimplifiedPcbTraces()).toEqual(a.traces)
})
