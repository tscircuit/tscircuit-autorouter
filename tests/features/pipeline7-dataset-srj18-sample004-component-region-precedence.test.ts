import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 dataset-srj18 sample004 uses merged topology for port point pathing endpoints", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 4, 0.1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 0.1,
    cacheProvider: null,
  })

  solver.solveUntilPhase("nodeDimensionSubdivisionSolver")

  const topologyOutput = solver.topologyPlanningSolver!.getOutput()
  const componentNodeIds = new Set(
    topologyOutput.componentMeshNodes
      .flat()
      .map((node) => node.capacityMeshNodeId),
  )
  const mergedNodeIds = solver
    .topologyMergingSolver!.getOutput()
    .map((node) => node.capacityMeshNodeId)

  expect(solver.capacityNodes?.map((node) => node.capacityMeshNodeId)).toEqual(
    mergedNodeIds,
  )
  expect(componentNodeIds.size).toBeGreaterThan(0)

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
    solver.portPointPathingSolver?.stats.staticallyUnroutableRouteCount ?? 0,
  ).toBe(0)
})
