import { expect, test } from "bun:test"
import { sample001 } from "dataset-srj18"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"

test("boundary contracts complete on a real board with reversed owner metadata", () => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(sample001),
  )
  while (
    !solver.failed &&
    !solver.solved &&
    solver.getCurrentPhase() !== "highDensityRouteSolver"
  ) {
    solver.step()
  }
  expect(solver.failed).toBe(false)
  expect(solver.getCurrentPhase()).toBe("highDensityRouteSolver")
  expect(solver.boundaryContractSolver!.solved).toBe(true)
  expect(solver.boundaryContractSolver!.stats.certifiedBoundaries).toBeGreaterThan(0)
  expect(solver.boundaryContractSolver!.getOutput()).toHaveLength(
    solver.uniformPortDistributionSolver!.getOutput().length,
  )
})
