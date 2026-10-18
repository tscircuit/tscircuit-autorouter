import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types"
import srj from "../fixtures/core-differential-pair-pad-clearance.json"

test("Pipeline9 cooperative solve preserves synchronous routes and work", async (): Promise<void> => {
  const synchronous = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj) as SimpleRouteJson,
  )
  const cooperative = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj) as SimpleRouteJson,
  )
  synchronous.solve()
  await cooperative.solveAsync()
  expect(synchronous.solved).toBe(true)
  expect(cooperative.solved).toBe(true)
  expect(cooperative.failed).toBe(false)
  expect(cooperative.iterations).toBe(synchronous.iterations)
  expect(cooperative._getOutputHdRoutes()).toEqual(
    synchronous._getOutputHdRoutes(),
  )
  expect(cooperative.getOutputSimplifiedPcbTraces()).toEqual(
    synchronous.getOutputSimplifiedPcbTraces(),
  )
})
