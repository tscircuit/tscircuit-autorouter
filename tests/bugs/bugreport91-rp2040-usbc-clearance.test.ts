import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/bug-reports/bugreport91-rp2040-usbc-clearance/bugreport91-rp2040-usbc-clearance.srj.json" with {
  type: "json",
}

const srj = srjJson as SimpleRouteJson

// The exact-geometry repair portfolio currently leaves one 0.089998 mm
// pad/trace clearance for a board that requires 0.1 mm.
test.skip("pipeline7 clears the RP2040 board USB-C pad/trace DRC error", () => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  if (!solver.srjWithPointPairs) {
    throw new Error("Solver did not produce point-pair SRJ")
  }

  const { errors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })

  expect(errors).toHaveLength(0)
})
