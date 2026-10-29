import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/repro/rp2350-complete-board-drc/rp2350-normal-core-phase.srj.json" with {
  type: "json",
}

test.skip("Pipeline9 routes the normal RP2350 core phase without DRC errors", (): void => {
  const input = structuredClone(srj) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })

  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  if (!solver.srjWithPointPairs) {
    throw new Error("Pipeline9 did not produce point-pair SRJ")
  }

  const circuitJson = convertToCircuitJson(
    solver.srjWithPointPairs,
    solver.getOutputSimplifiedPcbTraces(),
    { minTraceWidth: input.minTraceWidth },
  )
  const { errors } = getDrcErrors(circuitJson, {
    traceClearance: 0.1,
    viaClearance: 0.1,
  })

  expect(errors).toHaveLength(0)
})
