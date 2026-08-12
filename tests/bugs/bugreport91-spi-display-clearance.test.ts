import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/bug-reports/bugreport91-spi-display-clearance/bugreport91-spi-display-clearance.srj.json" with {
  type: "json",
}

const srj = srjJson as SimpleRouteJson

test.skip("bugreport91 routes the SPI display without clearance errors", () => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const { circuitJson, errors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  const clearanceErrorTypes = errors
    .filter(
      (error) =>
        error.type === "pcb_pad_trace_clearance_error" ||
        error.type === "pcb_via_trace_clearance_error",
    )
    .map((error) => error.type)
    .sort()

  expect(clearanceErrorTypes).toEqual([])
  expect(
    convertCircuitJsonToPcbSvg([...circuitJson, ...errors], {
      backgroundColor: "white",
      shouldDrawErrors: true,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})
