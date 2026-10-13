import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 reroutes contiguous preloaded sections in corrected SRJ23 sample 4", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 4)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solveUntilPhase("highDensityRouteSolver")
  // Exercise regional repair with the original uniform crossings. Copper-aware
  // spacing now avoids this conflict, so the normal pipeline need not repair it.
  const pathing = solver.portPointPathingSolver!.getOutput()
  solver.uniformPortDistributionSolver = new UniformPortDistributionSolver({
    nodeWithPortPoints: pathing.nodesWithPortPoints,
    inputNodesWithPortPoints: pathing.inputNodeWithPortPoints,
    obstacles: scenario.obstacles,
    layerCount: scenario.layerCount,
    useLayerAwareGeometry: scenario.layerCount > 2,
    preserveSolitaryPorts: Boolean(scenario.traces?.length),
  })
  solver.uniformPortDistributionSolver.solve()
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(
    Number(solver.highDensityRouteSolver?.stats.fallbackNodeCount),
  ).toBeGreaterThan(0)
  expect(solver.getMutatedPreloadedTraces().length).toBeGreaterThan(0)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toHaveLength(0)
})
