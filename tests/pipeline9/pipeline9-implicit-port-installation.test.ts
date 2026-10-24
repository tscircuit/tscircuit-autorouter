import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

test("default P9 installs implicit transitions before the native solver starts while preserving its label and allowance", (): void => {
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph({
    layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 }, obstacles: [],
    connections: [{name: "wire", pointsToConnect: [{x: -4, y: 0, layer: "top"}, {x: 4, y: 0, layer: "top"}]}],
  }, {effort: 0.1})
  pipeline.solveUntilPhase("portPointPathingSolver")
  expect(pipeline.failed).toBeFalse()
  const step = pipeline.pipelineDef.find(p => p.solverName === "portPointPathingSolver")!
  const [params] = step.getConstructorParams(pipeline) as [HgPortPointPathingSolverParams]
  expect(params.flags.USE_IMPLICIT_REGIONAL_TRANSITIONS).toBeTrue()
  const solver = new TinyHypergraphPortPointPathingSolver(params)
  for (let i = 0; solver.benchmarkDiagnosticCounters.implicitInstalledSolvers === 0 && i < 10; i++) solver.step()
  expect(solver.benchmarkDiagnosticCounters.implicitInstalledSolvers).toBe(1)
  const native = (solver as unknown as { tinyPipelineSolver: {activeSubSolver: {getSolverName(): string; MAX_ITERATIONS: number}} }).tinyPipelineSolver.activeSubSolver
  expect(native.getSolverName()).toBe("SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments")
  expect(native.MAX_ITERATIONS).toBe(200000)
  expect(solver.benchmarkDiagnosticCounters.implicitExpansions).toBe(0)
})
