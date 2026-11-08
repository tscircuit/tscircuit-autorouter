import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderPlanarShortcutView } from "../fixtures/renderPlanarShortcutView"

test("RVboy retains separate completed bypass connections during native repair", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-retained-connection-identity.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as { input: SimpleRouteJson; before: SimplifiedPcbTraces }
  const original = structuredClone(fixture)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.input,
    {
      effort: 5,
      cacheProvider: null,
    },
  )
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: fixture.input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    includeBoardClearance: true,
    drcOptions: { traceClearance: 0.1, viaClearance: 0.4 },
  })
  expect(evaluate(fixture.before).errors).toContainEqual(
    expect.objectContaining({
      type: "pcb_pad_trace_clearance_error",
      pcb_pad_id: "pcb_smtpad_189",
      actual_clearance: expect.closeTo(0.07, 6),
    }),
  )
  const after = solver.getOutputSimpleRouteJson().traces!
  expect(evaluate(after).errors).toEqual([])
  for (const fixed of fixture.input.traces!)
    expect(
      after.find((trace) => trace.pcb_trace_id === fixed.pcb_trace_id),
    ).toEqual(fixed)
  expect(fixture).toEqual(original)
  for (const [state, traces] of [
    ["before", fixture.before],
    ["after", after],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      ...fixture.input,
      obstacles: fixture.input.obstacles.filter(
        (obstacle) => !obstacle.isCopperPour,
      ),
      connections: [],
      traces,
    })
    await expect(
      renderPlanarShortcutView(graphics, {
        minX: -3.5,
        maxX: -1.3,
        minY: 4,
        maxY: 6.7,
      }),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: state })
  }
})
