import { expect, test } from "bun:test"
import { computeCostPerRegion } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/computeCost"
import type { SimpleRouteJson } from "lib/types"
import bugreport23 from "../../fixtures/bug-reports/bugreport23-LGA15x4/bugreport23-LGA15x4.srj.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "../../lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"

test("bugreport23 hg - should not fail with null z property in port points", () => {
  const solver = new AutoroutingPipelineSolver3_HgPortPointPathing(
    bugreport23 as unknown as SimpleRouteJson,
    {
      effort: 4,
    },
  )

  while (solver.getCurrentPhase() !== "portPointPathingSolver") {
    solver.step()
  }
  const startTime = Date.now()
  const time = () => `${((Date.now() - startTime) / 1000).toFixed(2)}s`
  let lastLoggedIteration = -1
  while (solver.getCurrentPhase() === "portPointPathingSolver") {
    solver.step()
    const hgSolver = solver.portPointPathingSolver as any
    const graph = hgSolver?.params?.graph
    const iteration = hgSolver?.iterations ?? 0
    if (graph && iteration !== lastLoggedIteration && iteration % 50 === 0) {
      lastLoggedIteration = iteration
      const totalRegionCost = graph.regions.reduce(
        (sum: number, region: any) => sum + computeCostPerRegion(region),
        0,
      )
      console.log(
        iteration,
        totalRegionCost.toFixed(4),
        hgSolver?.iterations,
        time(),
      )
    }
  }
  const hgSolver = solver.portPointPathingSolver as any
  const graph = hgSolver?.params?.graph
  if (graph) {
    const totalRegionCost = graph.regions.reduce(
      (sum: number, region: any) => sum + computeCostPerRegion(region),
      0,
    )
    console.log(
      hgSolver?.iterations ?? 0,
      totalRegionCost.toFixed(4),
      hgSolver?.iterations,
      time(),
    )
  } else {
    console.log(0, "missing-graph", time())
  }

  expect(solver.failed).toBe(false)
  expect(solver.portPointPathingSolver?.solved).toBe(true)
})
