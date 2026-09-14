import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { filterPipeline9DrcErrorsAgainstBaseline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/filterPipeline9DrcErrorsAgainstBaseline"
import type { Pipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

const fixtureUrl = new URL(
  "../../fixtures/bug-reports/t113-linux-final-phase-preloaded-splice/t113-linux-final-phase-preloaded-splice.srj.json.gz",
  import.meta.url,
)
const srj = JSON.parse(
  gunzipSync(Uint8Array.from(readFileSync(fixtureUrl))).toString("utf8"),
) as SimpleRouteJson

test("Pipeline9 reconnects the exact T113-S3 final-phase preloaded splice", () => {
  expect(srj.connections).toHaveLength(29)
  expect(srj.obstacles).toHaveLength(397)
  expect(srj.traces).toHaveLength(342)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const outputTraces = solver.getOutputSimpleRouteJson().traces
  expect(outputTraces.length).toBeGreaterThan(srj.traces.length)
  expect(
    outputTraces.flatMap((trace) =>
      trace.route.slice(0, -1).flatMap((point, pointIndex) => {
        const nextPoint = trace.route[pointIndex + 1]!
        return point.route_type === "wire" &&
          nextPoint.route_type === "wire" &&
          point.layer !== nextPoint.layer
          ? [{ traceId: trace.pcb_trace_id, pointIndex }]
          : []
      }),
    ),
  ).toEqual([])

  const fixedTraces = (
    solver.powerTraceExpansionSolver!.inputSrj as Pipeline7PowerTraceExpansionInput
  ).fixedTraces
  const drcOptions = {
    traceClearance: srj.minTraceToPadEdgeClearance ?? 0.1,
    viaPadClearance: srj.minViaEdgeToPadEdgeClearance ?? 0.1,
    includeTraceContinuity: false,
  }
  const baselineDrc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: [],
    drcOptions,
  })
  const finalDrc = evaluateRelaxedDrc({
    inputSrj: { ...srj, traces: fixedTraces },
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.postPowerTraceViaMergeSolver!.getOutput(),
    drcOptions,
  })
  expect(
    filterPipeline9DrcErrorsAgainstBaseline({
      errors: finalDrc.errors as unknown as Array<Record<string, unknown>>,
      baselineErrors: baselineDrc.errors as unknown as Array<
        Record<string, unknown>
      >,
      originalTraceIdByPreparedTraceId: new Map(),
    }),
  ).toEqual([])
})
