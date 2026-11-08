import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderPlanarShortcutView } from "../fixtures/renderPlanarShortcutView"

const length = (trace: SimplifiedPcbTraces[number]): number =>
  trace.route.reduce((sum, point, index) => {
    if (point.route_type === "via") return sum + 1.6
    const previous = trace.route[index - 1]
    return (
      sum +
      (point.route_type === "wire" &&
      previous?.route_type === "wire" &&
      point.layer === previous.layer
        ? Math.hypot(point.x - previous.x, point.y - previous.y)
        : 0)
    )
  }, 0)

test("RVboy ground-plane returns allow valid native cleanup candidates", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-native-via-plane-cleanup.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as {
    input: SimpleRouteJson
    before: SimplifiedPcbTraces
  }
  const original = structuredClone(fixture.input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.input,
    { effort: 5, cacheProvider: null },
  )
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const output = solver.getOutputSimpleRouteJson()
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: fixture.input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    includeBoardClearance: true,
    drcOptions: { traceClearance: 0.1, viaClearance: 0.4 },
  })
  expect(evaluate(solver.getOutputSimplifiedPcbTraces()).errors).toEqual([])
  const before = fixture.before.find(
    (trace) => trace.connection_name === "source_trace_331",
  )!
  const after = output.traces!.find(
    (trace) => trace.connection_name === "source_trace_331",
  )!
  expect(length(before)).toBeGreaterThan(12)
  expect(length(after)).toBeLessThan(6)
  expect(
    after.route.filter((point) => point.route_type === "via"),
  ).toHaveLength(0)
  for (const fixed of original.traces!) {
    expect(
      output.traces!.find((trace) => trace.pcb_trace_id === fixed.pcb_trace_id),
    ).toEqual(fixed)
  }
  expect(fixture.input).toEqual(original)
  for (const [state, traces] of [
    ["before", fixture.before],
    ["after", output.traces!],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      ...fixture.input,
      obstacles: fixture.input.obstacles.filter((o) => !o.isCopperPour),
      connections: [],
      traces,
    })
    await expect(
      renderPlanarShortcutView(graphics, {
        minX: -4,
        maxX: 6.5,
        minY: -1.5,
        maxY: 5,
      }),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: state })
  }
})
