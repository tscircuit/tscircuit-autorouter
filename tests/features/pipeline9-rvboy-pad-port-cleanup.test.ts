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

test("RVboy phase-local pad ownership permits short native reset routing", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-pad-port-cleanup.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as { inputs: SimpleRouteJson[]; before: SimplifiedPcbTraces }
  const original = structuredClone(fixture)
  let output: SimplifiedPcbTraces | undefined
  for (const captured of fixture.inputs) {
    const input = structuredClone(captured)
    if (output) {
      const metadata = new Map(
        input.traces!.map((trace) => [trace.pcb_trace_id, trace]),
      )
      input.traces = output.map((trace) => {
        const retained = metadata.get(trace.pcb_trace_id)
        if (!retained)
          throw new Error(
            `Captured next phase has no retained trace ${trace.pcb_trace_id}`,
          )
        return { ...retained, route: structuredClone(trace.route) }
      })
    }
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      effort: 5,
      cacheProvider: null,
    })
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    const evaluate = createPipeline9AutoroutingDrcEvaluator({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      includeBoardClearance: true,
      drcOptions: { traceClearance: 0.1, viaClearance: 0.4 },
    })
    expect(evaluate(solver.getOutputSimplifiedPcbTraces()).errors).toEqual([])
    output = solver.getOutputSimpleRouteJson().traces!
    for (const fixed of input.traces!)
      expect(
        output.find((trace) => trace.pcb_trace_id === fixed.pcb_trace_id),
      ).toEqual(fixed)
  }
  const before = fixture.before.find(
    (trace) => trace.connection_name === "source_trace_283",
  )!
  const after = output!.find(
    (trace) => trace.connection_name === "source_trace_283",
  )!
  expect(length(before)).toBeGreaterThan(8)
  expect(length(after)).toBeLessThan(5)
  expect(
    after.route.filter((point) => point.route_type === "via"),
  ).toHaveLength(0)
  for (const index of [0, -1]) {
    const a = after.route.at(index)
    const b = before.route.at(index)
    if (a?.route_type !== "wire" || b?.route_type !== "wire")
      throw new Error("Reset route must retain wire terminals")
    expect({ x: a.x, y: a.y }).toEqual({ x: b.x, y: b.y })
  }
  expect(fixture).toEqual(original)
  for (const [state, traces] of [
    ["before", fixture.before],
    ["after", output!],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      ...fixture.inputs.at(-1)!,
      obstacles: fixture.inputs
        .at(-1)!
        .obstacles.filter((obstacle) => !obstacle.isCopperPour),
      connections: [],
      traces,
    })
    await expect(
      renderPlanarShortcutView(graphics, {
        minX: 3.8,
        maxX: 10.3,
        minY: 2.1,
        maxY: 7.7,
      }),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: state })
  }
})
