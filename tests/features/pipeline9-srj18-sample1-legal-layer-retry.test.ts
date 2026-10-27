import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 retries an impossible SRJ18 node across legal layers", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 1)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  // Freeze the original global topology so this regression still exercises
  // the impossible-node retry; the racing global solver can avoid that node.
  solver.solveUntilPhase("portPointPathingSolver")
  solver.step()
  const originalPathing = solver.portPointPathingSolver
  if (!originalPathing) throw new Error("Port-point stage was not initialized")
  const fixedPathing = new TinyHypergraphPortPointPathingSolver({
    ...originalPathing.getConstructorParams()[0],
    useDeterministicRace: false,
  })
  solver.portPointPathingSolver = fixedPathing
  solver.activeSubSolver = fixedPathing

  solver.solveUntilPhase("highDensityStitchSolver")

  expect(solver.failed).toBeFalse()
  expect(solver.highDensityRouteSolver?.solved).toBeTrue()
  expect(solver.highDensityRouteSolver?.stats.fallbackNodeCount).toBe(1)
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
