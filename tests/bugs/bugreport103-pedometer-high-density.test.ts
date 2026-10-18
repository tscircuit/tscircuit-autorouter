import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

test("Pipeline9 does not detail-route an invalid pedometer timeout graph", async (): Promise<void> => {
  const srj: SimpleRouteJson = await Bun.file(
    new URL(
      "../../public/fixtures/bugreport103-pedometer.srj.json",
      import.meta.url,
    ),
  ).json()
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    // Force timeout acceptance; this is not a board-solvability assertion.
    effort: 0.01,
    cacheProvider: null,
  })
  // Keep this strict-model rejection test distinct from legacy layer hints.
  const pathing = pipeline.pipelineDef.find(
    (step) => step.solverName === "portPointPathingSolver",
  )!
  const getParams = pathing.getConstructorParams
  pathing.getConstructorParams = (cms) => {
    const [params] = getParams(cms) as [HgPortPointPathingSolverParams]
    return [{ ...params, regionLayerMasksAreBinding: true }]
  }
  while (!pipeline.highDensityRouteSolver?.solved && !pipeline.failed) {
    pipeline.step()
  }

  expect(pipeline.failed).toBe(true)
  expect(pipeline.portPointPathingSolver?.failed).toBe(true)
  expect(pipeline.portPointPathingSolver?.solved).toBe(false)
  expect(pipeline.highDensityRouteSolver).toBeUndefined()
  expect(pipeline.error).toContain("ran out of iterations")
})
