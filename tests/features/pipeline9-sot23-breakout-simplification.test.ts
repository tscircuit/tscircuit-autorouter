import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import input from "../fixtures/pipeline9-sot23-breakout.json"

test("Pipeline9 simplifies SOT23 breakout routes beside same-net preloaded copper", () => {
  const srj = structuredClone(input) as unknown as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  const output = solver.getOutputSimpleRouteJson()
  expect(output.traces).toHaveLength(12)
  // This small board previously retained a 50-point ground detour and nine vias.
  expect(
    Math.max(...output.traces!.map((trace) => trace.route.length)),
  ).toBeLessThanOrEqual(20)
  expect(
    output.traces!.flatMap((trace) =>
      trace.route.filter((point) => point.route_type === "via"),
    ),
  ).toHaveLength(8)
  const drc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(drc.errors).toHaveLength(0)
  expect(convertSrjToGraphicsObject(output)).toMatchGraphicsSvg(
    import.meta.path,
  )
})
