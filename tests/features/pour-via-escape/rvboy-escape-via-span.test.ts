import { expect, test } from "bun:test"
import inputJson from "../../../fixtures/bug-reports/rvboy-escape-via-span/rvboy-native.srj.json"
import { getRvboyEscapeViaSpanView } from "../../../fixtures/bug-reports/rvboy-escape-via-span/getRvboyEscapeViaSpanView"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../../lib/types"

test("RVboy reserves ground escape vias on all four physical layers", async (): Promise<void> => {
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(inputJson) as SimpleRouteJson,
    { cacheProvider: null },
  )
  while (!pipeline.escapeViaLocationSolver && !pipeline.failed) pipeline.step()
  expect(pipeline.failed).toBe(false)
  const solver = pipeline.escapeViaLocationSolver!
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const output = solver.getOutputSimpleRouteJson()
  const vias = output.obstacles.filter((obstacle) =>
    obstacle.obstacleId?.startsWith("escape-via-obstacle:"),
  )
  expect(vias.length).toBeGreaterThan(0)
  for (const via of vias) {
    expect(via.layers).toEqual(["top", "inner1", "inner2", "bottom"])
    expect(via.__zLayers).toEqual([0, 1, 2, 3])
  }
  await expect(getRvboyEscapeViaSpanView(output)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
