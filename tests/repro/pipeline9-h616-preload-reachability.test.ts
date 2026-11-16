import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { AnyCircuitElement } from "circuit-json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { combinePreloadedAndRoutedTraces } from "lib/utils/combinePreloadedAndRoutedTraces"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import { getH616PreloadReachabilityPcbSvg } from "tests/fixtures/getH616PreloadReachabilityPcbSvg"

type H616ReachabilityFixture = {
  srj: SimpleRouteJson
  circuitJson: AnyCircuitElement[]
  fixedTraces: SimplifiedPcbTrace[]
}

test("captures H616 ordinary-signal routing around preloaded DDR traces", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-preload-reachability.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as H616ReachabilityFixture
  const original = structuredClone(fixture)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(fixture.srj)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(fixture).toEqual(original)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: fixture.srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    includeBoardClearance: true,
  })
  expect(
    evaluate(routedTraces, { includeTraceContinuity: true }).errors,
  ).toEqual([])
  const allTraces = [
    ...fixture.fixedTraces,
    ...combinePreloadedAndRoutedTraces(fixture.srj.traces ?? [], routedTraces),
  ]
  const copper = convertToCircuitJson(fixture.srj, allTraces).flatMap(
    (element): AnyCircuitElement[] => {
      if (element.type === "pcb_trace") {
        const trace = allTraces.find(
          (trace) => trace.pcb_trace_id === element.pcb_trace_id,
        )!
        return [{ ...element, source_trace_id: trace.connection_name }]
      }
      return element.type === "pcb_via"
        ? [{ ...element, pcb_via_id: `routed_${element.pcb_via_id}` }]
        : []
    },
  )
  const circuitJson = [...fixture.circuitJson, ...copper]
  const routedNetCount = new Set(
    allTraces.map((trace) => trace.connection_name),
  ).size
  expect(routedNetCount).toBe(109)
  await expect(
    getH616PreloadReachabilityPcbSvg({ circuitJson, routedNetCount }),
  ).toMatchSvgSnapshot(import.meta.path, { scale: 1 })
  await expect(
    getH616PreloadReachabilityPcbSvg({
      circuitJson,
      routedNetCount,
      focused: true,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "reference", scale: 1 })
})
