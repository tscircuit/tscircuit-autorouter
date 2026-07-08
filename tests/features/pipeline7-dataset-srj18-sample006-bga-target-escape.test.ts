import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 dataset-srj18 sample006 routes BGA endpoint obstacle escape", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 6, 0.1)
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

  const portPointPathingSolver = solver.portPointPathingSolver
  const [params] = portPointPathingSolver!.getConstructorParams()
  const targetRoute = params.connections.find(
    (connection) =>
      connection.connectionId === "source_trace_53__source_net_131",
  )

  expect(solver.failed).toBe(false)
  expect(portPointPathingSolver?.failed).toBe(false)
  expect(portPointPathingSolver?.solved).toBe(true)
  expect(
    portPointPathingSolver?.stats.staticallyUnroutableRouteCount ?? 0,
  ).toBe(0)
  expect(targetRoute).toBeDefined()
  expect(targetRoute!.startRegion.d._containsObstacle).toBe(true)
  expect(targetRoute!.startRegion.d._containsTarget).toBe(true)
  expect(targetRoute!.startRegion.ports.length).toBeGreaterThan(0)
})
