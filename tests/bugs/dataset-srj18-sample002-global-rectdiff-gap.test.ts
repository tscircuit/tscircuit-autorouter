import { expect, test } from "bun:test"
import { dataset } from "dataset-srj18"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"

test("pipeline7 srj18 sample002 global rectdiff fills recursive gaps", (): void => {
  const srj: SimpleRouteJson = structuredClone(
    dataset.sample002 as SimpleRouteJson,
  )
  const solver: AutoroutingPipelineSolver7_MultiGraph =
    new AutoroutingPipelineSolver7_MultiGraph(srj, { cacheProvider: null })

  solver.solveUntilPhase("globalTopologyGeneratorSolver")
  while (
    solver.getCurrentPhase() === "globalTopologyGeneratorSolver" &&
    !solver.failed
  ) {
    solver.step()
  }

  expect(solver.failed).toBe(false)
  expect(solver.getCurrentPhase()).toBe("nodeDimensionSubdivisionSolver")
  expect(solver.globalTopologyGeneratorSolver?.solved).toBe(true)

  const passExpandedCounts: number[] =
    solver.globalTopologyGeneratorSolver!.gapFillSolver!.passExpandedCounts
  const hadRecursiveExpansion: boolean = passExpandedCounts
    .slice(0, -1)
    .some((count: number): boolean => count > 0)

  expect(passExpandedCounts.length).toBeGreaterThan(1)
  expect(hadRecursiveExpansion).toBe(true)
  expect(passExpandedCounts.at(-1)).toBe(0)
})
