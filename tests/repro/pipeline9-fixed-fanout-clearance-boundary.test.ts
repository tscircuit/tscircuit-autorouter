import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

type FixedFanoutFixture = SimpleRouteJson & { traces: SimplifiedPcbTrace[] }

test("routes six signals beside fixed fanout copper at exact clearance", async (): Promise<void> => {
  const input = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "./assets/native-six-signal-fixed-fanout.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as FixedFanoutFixture
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const output = solver.getOutputSimpleRouteJson()
  for (const fixedTrace of input.traces) {
    const preservedTrace = output.traces!.find(
      (trace) => trace.pcb_trace_id === fixedTrace.pcb_trace_id,
    )
    expect(preservedTrace?.route).toEqual(fixedTrace.route)
    expect(preservedTrace?.isFixed).toBe(true)
  }
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  for (const connection of input.connections) {
    expect(
      routedTraces.some((trace) => trace.connection_name === connection.name),
    ).toBe(true)
  }
  expect(
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }).errors,
  ).toEqual([])
  await expect(
    getSvgFromGraphicsObject(convertSrjToGraphicsObject(output), {
      backgroundColor: "white",
    }).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path)
})
