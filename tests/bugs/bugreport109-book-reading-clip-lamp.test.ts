import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getPendingEffectsFromSolverTree } from "lib/solvers/getPendingEffectsFromSolverTree"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "../../fixtures/bug-reports/bugreport109-book-reading-clip-lamp/bugreport109-book-reading-clip-lamp.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

test("bugreport109: Pipeline 9 attempts to route the full reading lamp circuit", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(capturedInput) as SimpleRouteJson,
    { cacheProvider: null, effort: 1 },
  )
  while (!solver.solved && !solver.failed) {
    solver.step()
    const effects = getPendingEffectsFromSolverTree(solver)
    if (effects.length > 0) {
      await Promise.all(effects.map((effect) => effect.promise))
    }
  }

  // Current Pipeline 9 fails before detailed routing; preserve that outcome.
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain(
    "source_net_0_mst26 (pcb_port_417->pcb_port_403)",
  )
  await expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
