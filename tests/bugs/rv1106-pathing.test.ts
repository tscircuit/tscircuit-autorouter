import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import input from "./assets/rv1106-pathing/input.json"

const MAX_PATHING_RUNTIME_MS = 30_000

test("Pipeline9 routes RV1106 with copper-pour-aware free regions", async () => {
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(input) as SimpleRouteJson,
    { cacheProvider: null },
  )
  while (!pipeline.portPointPathingSolver && !pipeline.failed) pipeline.step()
  const pathing = pipeline.portPointPathingSolver!
  const startedAt = performance.now()
  while (!pathing.failed && !pathing.solved) pathing.step()
  const elapsedMs = performance.now() - startedAt
  expect(pipeline.failed).toBe(false)
  expect(pathing.failed).toBe(false)
  expect(pathing.solved).toBe(true)
  expect(elapsedMs).toBeLessThan(MAX_PATHING_RUNTIME_MS)
  expect(pipeline.highDensityRouteSolver).toBeUndefined()
  await expect(getLastStepSvg(pathing.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
