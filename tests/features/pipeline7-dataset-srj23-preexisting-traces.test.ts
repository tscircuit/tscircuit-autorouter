import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 dataset-srj23 sample015 skips connections with preexisting traces", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 15, 0.1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(scenario),
    { effort: 0.1, cacheProvider: null },
  )

  solver.solveUntilPhase("netToPointPairsSolver")
  while (solver.getCurrentPhase() === "netToPointPairsSolver") {
    solver.step()
  }

  expect(solver.failed).toBe(false)
  expect(scenario.connections).toHaveLength(5)
  expect(scenario.traces).toHaveLength(4)
  expect(solver.srjWithPointPairs?.connections.map(({ name }) => name)).toEqual([
    "source_net_1",
  ])
})
