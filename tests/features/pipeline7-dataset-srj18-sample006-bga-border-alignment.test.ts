import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 dataset-srj18 sample006 rejects a BGA target without a routing edge", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 6, 0.1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 0.1,
    cacheProvider: null,
  })

  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("has no bordering routing edge")
})
