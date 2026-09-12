import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import capturedPreFixTraces from "../../fixtures/bug-reports/gameboy-through-via-drc/gameboy-through-via-drc.pre-fix-traces.json" with {
  type: "json",
}
import capturedGameBoySrj from "../../fixtures/bug-reports/gameboy-through-via-drc/gameboy-through-via-drc.srj.json" with {
  type: "json",
}

test("Pipeline9 repairs the captured Game Boy's physical through-via DRCs", (): void => {
  // This is the 112-connection, four-layer Game Boy input captured from
  // gameboy-advance. Its published Pipeline9 result put a bottom trace
  // through two top-to-inner2 vias while blind/buried vias were disabled.
  const inputSrj = structuredClone(capturedGameBoySrj) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
    effort: 1,
  })

  expect(inputSrj.connections).toHaveLength(112)
  expect(inputSrj.obstacles).toHaveLength(393)
  expect(inputSrj.layerCount).toBe(4)
  expect(inputSrj.allowBlindAndBuriedVias).toBeFalse()
  expect(inputSrj.traces ?? []).toHaveLength(0)

  solver.solve()

  expect(solver.srjWithPointPairs).toBeDefined()
  const capturedDrc = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: capturedPreFixTraces as SimplifiedPcbTrace[],
    includeBoardClearance: true,
  })
  expect(capturedDrc.errors.map((error) => error.type).sort()).toEqual([
    "pcb_trace_error",
    "pcb_trace_error",
    "pcb_via_trace_clearance_error",
  ])

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const repairedDrc = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    includeBoardClearance: true,
  })
  expect(repairedDrc.errors).toEqual([])
})
