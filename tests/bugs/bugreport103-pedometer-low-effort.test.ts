import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"

test("pedometer reports an exhausted low-effort budget instead of accepting forbidden crossings", async (): Promise<void> => {
  const srj: SimpleRouteJson = await Bun.file(
    new URL(
      "../../public/fixtures/bugreport103-pedometer.srj.json",
      import.meta.url,
    ),
  ).json()
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    effort: 0.01,
    cacheProvider: null,
  })
  let tinySolver: TinyHyperGraphSolver | undefined
  while (!pipeline.portPointPathingSolver?.solved && !pipeline.failed) {
    pipeline.step()
    let active = pipeline.activeSubSolver
    while (active) {
      if (active instanceof TinyHyperGraphSolver) tinySolver = active
      active = active.activeSubSolver
    }
  }
  expect(tinySolver).toBeDefined()
  expect(pipeline.failed).toBe(true)
  expect(pipeline.error).toContain("ran out of iterations")
  expect(tinySolver!.iterations).toBe(tinySolver!.MAX_ITERATIONS)
  expect(tinySolver!.solved).toBe(false)
  expect(tinySolver!.stats.acceptedGreedyFinalRouteOnTimeout).not.toBe(true)
  expect(pipeline.highDensityRouteSolver).toBeUndefined()
})
