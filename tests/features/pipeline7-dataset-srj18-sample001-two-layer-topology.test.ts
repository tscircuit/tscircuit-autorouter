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
})
