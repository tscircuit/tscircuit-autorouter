import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 routes every pedometer high-density region", async (): Promise<void> => {
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

  expect(pipeline.failed).toBe(false)
  expect(pipeline.portPointPathingSolver?.solved).toBe(true)
  const highDensitySolver = pipeline.highDensityRouteSolver!
  expect(highDensitySolver.solved).toBe(true)
  expect(Number(highDensitySolver.stats.nodeCount)).toBeGreaterThan(0)
  expect(highDensitySolver.stats.solvedNodeCount).toBe(
    highDensitySolver.stats.nodeCount,
  )
  expect(highDensitySolver.unsolvedNodePortPoints).toHaveLength(0)
  expect(() =>
    materializePipeline9HdRouteVias(highDensitySolver.routes),
  ).not.toThrow()
})
