import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import pedometer from "../../fixtures/bug-reports/bugreport104-pedometer-v1.0.6.unrouted.srj.json" with {
  type: "json",
}

// Run manually to regenerate the solved-board snapshot; keep skipped in CI.
test.skip("bugreport104 Pipeline9 solved board without preloaded traces", async () => {
  const input: SimpleRouteJson = {
    ...structuredClone(pedometer as SimpleRouteJson),
    traces: [],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.failed, `Pipeline9 failed: ${solver.error}`).toBe(false)
  expect(solver.solved).toBe(true)
  const output = solver.getOutputSimpleRouteJson()
  expect(output.traces!.length).toBeGreaterThan(0)
  const graphics = convertSrjToGraphicsObject(output)
  // Connection debug dots obscure the fine-pitch pads and escape traces.
  graphics.points = []
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
