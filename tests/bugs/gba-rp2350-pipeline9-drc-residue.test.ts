import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "../../fixtures/bug-reports/gba-rp2350-pipeline9-drc-residue/gba-rp2350-pipeline9-drc-residue.srj.json" with {
  type: "json",
}

test("Pipeline9 leaves DRC residue around the RP2350 after routing", () => {
  const srj = structuredClone(simpleRouteJson) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
    effort: 5,
  })

  expect(srj.connections).toHaveLength(24)
  expect(srj.obstacles).toHaveLength(411)

  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()

  const { circuitJson, errors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })

  expect(errors.map((error) => error.type)).toEqual([
    "pcb_via_trace_clearance_error",
    "pcb_pad_trace_clearance_error",
  ])
  expect(
    convertCircuitJsonToPcbSvg([...circuitJson, ...errors], {
      backgroundColor: "white",
      height: 1200,
      matchBoardAspectRatio: true,
      shouldDrawErrors: true,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
