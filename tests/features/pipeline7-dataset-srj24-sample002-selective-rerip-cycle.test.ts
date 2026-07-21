import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 escapes the srj24 sample002 selective-rerip cycle", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj24", 2)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario)

  solver.solveUntilPhase("portPointPathingSolver")
  while (
    solver.getCurrentPhase() === "portPointPathingSolver" &&
    !solver.failed &&
    !solver.solved
  ) {
    solver.step()
  }

  const pathingSolver = solver.portPointPathingSolver
  const solveGraphStats = (
    pathingSolver as unknown as {
      tinyPipelineSolver?: {
        getSolver(name: string): { stats?: Record<string, unknown> } | undefined
      }
    }
  ).tinyPipelineSolver?.getSolver("solveGraph")?.stats
  const singleLayerCrossingNodes =
    pathingSolver
      ?.getOutput()
      .nodesWithPortPoints.filter(
        (node) =>
          node.availableZ?.length === 1 &&
          getIntraNodeCrossingsUsingCircle(node).numSameLayerCrossings > 0,
      ) ?? []

  expect(solver.failed).toBe(false)
  expect(pathingSolver?.solved).toBe(true)
  expect(solveGraphStats?.selectiveReripCycleEscapeCount).toBeGreaterThan(0)
  expect(singleLayerCrossingNodes).toHaveLength(0)
})
