import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

const TARGET_NODE_ID =
  "obstacle-pcb_component_35-pcb_component_43:18.819999:0.548:0.46:0.4:bottom-5-18.819999-0.548"

test("pipeline7 preserves a routing neighbor for the inner BGA target in srj18 sample006", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 6, 0.1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 0.1,
    cacheProvider: null,
  })

  solver.solveUntilPhase("edgeSolver")

  const targetNode = solver.capacityNodes?.find(
    (node) => node.capacityMeshNodeId === TARGET_NODE_ID,
  )
  expect(targetNode).toBeDefined()

  const routingNeighbors = solver.capacityNodes?.filter(
    (node) =>
      node.capacityMeshNodeId !== TARGET_NODE_ID &&
      !node._containsObstacle &&
      !node._containsTarget &&
      targetNode!.availableZ.some((z) => node.availableZ.includes(z)) &&
      areNodesBordering(targetNode!, node),
  )
  expect(
    routingNeighbors?.some((node) => node.width * node.height >= 0.01),
  ).toBe(true)

  while (solver.getCurrentPhase() === "edgeSolver" && !solver.failed) {
    solver.step()
  }

  expect(solver.failed).toBe(false)
  expect(solver.edgeSolver?.failed).toBe(false)
  expect(solver.edgeSolver?.solved).toBe(true)
  expect(solver.getCurrentPhase()).toBe("availableSegmentPointSolver")
})
