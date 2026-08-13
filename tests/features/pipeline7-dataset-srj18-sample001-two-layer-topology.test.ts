import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 dataset-srj18 sample001 keeps topology within its two board layers", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 1, 0.1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 0.1,
    cacheProvider: null,
  })

  solver.solveUntilPhase("nodeDimensionSubdivisionSolver")

  const topologyNodes = solver.topologyMergingSolver!.getOutput()
  const usedZLayers = [
    ...new Set(topologyNodes.flatMap((node) => node.availableZ)),
  ].sort((a, b) => a - b)

  expect(scenario.layerCount).toBe(2)
  expect(solver.failed).toBe(false)
  expect(solver.topologyMergingSolver?.solved).toBe(true)
  expect(usedZLayers).toEqual([0, 1])
  expect(
    solver.originalSrj.obstacles.every(
      (obstacle) =>
        obstacle.layers.every((layer) => ["top", "bottom"].includes(layer)) &&
        obstacle.__zLayers?.every((z) => z === 0 || z === 1),
    ),
  ).toBe(true)
})

test("pipeline7 rejects dense region optimization that worsens downstream risk", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 1, 0.1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 0.1,
    cacheProvider: null,
  })

  solver.solveUntilPhase("portPointPathingSolver")
  while (
    solver.getCurrentPhase() === "portPointPathingSolver" &&
    !solver.failed &&
    !solver.solved
  ) {
    solver.step()
  }

  const optimizerMetrics =
    solver.portPointPathingSolver?.getSolveGraphBenchmarkMetrics()?.optimizer
  expect(solver.failed).toBe(false)
  expect(optimizerMetrics).toBeDefined()
  expect(optimizerMetrics!.downstreamAccepted).toBe(false)
  expect(optimizerMetrics!.downstreamRejectionReason).toBeDefined()
  expect(optimizerMetrics!.finalMaxRegionCost).toBeLessThan(
    optimizerMetrics!.initialMaxRegionCost,
  )
  expect(
    optimizerMetrics!.finalMaxProbabilityOfFailure >
      optimizerMetrics!.initialMaxProbabilityOfFailure ||
      optimizerMetrics!.totalProbabilityOfFailureReductionRatio < 0.02,
  ).toBe(true)
  expect(optimizerMetrics!.segmentDelta).toBeLessThanOrEqual(
    optimizerMetrics!.acceptedMutationCount * 4,
  )
})
