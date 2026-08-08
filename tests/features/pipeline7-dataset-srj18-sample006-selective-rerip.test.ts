import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 routes srj18 sample006 with capacity-aware pathing", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 6)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario)

  solver.solveUntilPhase("portPointPathingSolver")
  while (
    solver.getCurrentPhase() === "portPointPathingSolver" &&
    !solver.failed &&
    !solver.solved
  ) {
    solver.step()
  }

  expect(solver.failed).toBe(false)
  expect(solver.portPointPathingSolver?.failed).toBe(false)
  expect(solver.portPointPathingSolver?.solved).toBe(true)
  expect(
    solver.portPointPathingSolver?.getOutput().nodesWithPortPoints.length,
  ).toBeGreaterThan(0)
})
