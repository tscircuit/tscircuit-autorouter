import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"

test("pipeline7 dataset01 circuit119 solves pathing with only global topology", (): void => {
  const circuit119 = (dataset01 as Record<string, unknown>)
    .circuit119 as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(circuit119),
    { effort: 0.1, cacheProvider: null },
  )

  solver.solveUntilPhase("portPointPathingSolver")
  while (
    solver.getCurrentPhase() === "portPointPathingSolver" &&
    !solver.failed
  ) {
    solver.step()
  }

  expect(
    solver.topologyPlanningSolver?.getOutput().componentMeshNodes,
  ).toHaveLength(0)
  expect(solver.getCurrentPhase()).toBe("multiSectionPortPointOptimizer")
  expect(solver.failed).toBe(false)
  expect(solver.portPointPathingSolver?.failed).toBe(false)
  expect(solver.portPointPathingSolver?.solved).toBe(true)
  expect(solver.portPointPathingSolver?.error).toBeNull()
})
