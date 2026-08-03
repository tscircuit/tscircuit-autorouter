import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { getLastStepGraphicsObject } from "../fixtures/getLastStepGraphicsObject"

const FAILED_CONNECTION_ID = "source_trace_150__source_net_150"

const getConnectionGraphics = (
  solver: AutoroutingPipelineSolver7_MultiGraph,
): GraphicsObject => {
  const graphics = getLastStepGraphicsObject(solver.visualize())
  return {
    lines:
      graphics.lines?.filter((line) =>
        line.label?.includes(FAILED_CONNECTION_ID),
      ) ?? [],
    points:
      graphics.points?.filter((point) =>
        point.label?.includes(FAILED_CONNECTION_ID),
      ) ?? [],
    circles:
      graphics.circles?.filter((circle) =>
        circle.label?.includes(FAILED_CONNECTION_ID),
      ) ?? [],
  }
}

test("repro: six-layer SRJ18 sample006 exhausts tiny-hypergraph iterations", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 6)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    cacheProvider: null,
    effort: 0.7,
  })

  solver.solveUntilPhase("portPointPathingSolver")
  while (
    solver.getCurrentPhase() === "portPointPathingSolver" &&
    !solver.failed &&
    !solver.solved
  ) {
    solver.step()
  }

  expect(scenario.layerCount).toBe(6)
  expect(scenario.connections).toHaveLength(290)
  expect(solver.portPointPathingSolver?.solved).toBe(false)
  expect(solver.portPointPathingSolver?.failed).toBe(true)
  expect(solver.portPointPathingSolver?.error).toContain(
    "ran out of iterations",
  )
  expect(getConnectionGraphics(solver)).toMatchGraphicsSvg(import.meta.path)
})
