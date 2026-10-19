import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 routes SRJ18 sample 1 across legal layers without regional retry", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 1)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solveUntilPhase("highDensityStitchSolver")

  expect(solver.failed).toBeFalse()
  expect(solver.highDensityRouteSolver?.solved).toBeTrue()
  // The complete MST no longer creates the former impossible node. Dedicated
  // high-density tests still exercise the legal-layer retry itself.
  expect(solver.highDensityRouteSolver?.stats.fallbackNodeCount).toBe(0)
  expect(
    solver.highDensityRouteSolver?.routes.every((route) =>
      route.route.every((point) => point.z === 0 || point.z === 1),
    ),
  ).toBeTrue()
  expect(
    solver.highDensityRouteSolver?.routes.some((route) =>
      route.route.some((point) => point.z === 1),
    ),
  ).toBeTrue()
})
