import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 does not detail-route an invalid pedometer timeout graph", async (): Promise<void> => {
  const srj: SimpleRouteJson = await Bun.file(
    new URL(
      "../../public/fixtures/bugreport103-pedometer.srj.json",
      import.meta.url,
    ),
  ).json()
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    effort: 1,
    cacheProvider: null,
  })
  while (!pipeline.highDensityRouteSolver?.solved && !pipeline.failed) {
    pipeline.step()
  }

  expect(pipeline.failed).toBe(true)
  expect(pipeline.portPointPathingSolver?.failed).toBe(true)
  expect(pipeline.portPointPathingSolver?.solved).toBe(false)
  expect(pipeline.highDensityRouteSolver).toBeUndefined()
  expect(pipeline.error).toContain("ran out of iterations")
})
