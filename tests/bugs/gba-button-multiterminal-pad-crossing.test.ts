import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "../../fixtures/bug-reports/gba-button-multiterminal-pad-crossing/gba-button-multiterminal-pad-crossing.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

test("Pipeline9 records GBA multi-terminal traces crossing foreign pads", () => {
  // Exact button-pad positions and switch connectivity metadata extracted from
  // the full Game Boy Advance SRJ. No routed traces or route hints are preset.
  const srj = structuredClone(simpleRouteJson) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
    effort: 1,
  })

  solver.solve()

  const { errors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(errors).toHaveLength(4)
  expect(errors.every((error) => error.type === "pcb_trace_error")).toBeTrue()
  expect(
    errors
      .flatMap((error) => error.pcb_port_ids ?? [])
      .filter((portId) =>
        [
          "pcb_port_365",
          "pcb_port_369",
          "pcb_port_382",
          "pcb_port_386",
        ].includes(portId),
      )
      .sort(),
  ).toEqual(["pcb_port_365", "pcb_port_369", "pcb_port_382", "pcb_port_386"])
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 30_000)
