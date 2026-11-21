import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { renderGamepad } from "../../fixtures/repro/bluetooth-gamepad/render.mjs"

test("default Pipeline9 DRC count on the full Bluetooth gamepad", async () => {
  let completed = false
  const errors = await renderGamepad((input) => {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    completed = true
    return solver.getOutputSimplifiedPcbTraces()
  })
  expect(completed).toBe(true)
  expect(errors.length).toMatchInlineSnapshot(`10`)
})
