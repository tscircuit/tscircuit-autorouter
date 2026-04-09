import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

test(
  "pipeline4 dataset01 circuit155 avoids via-to-trace overlaps after high-density routing",
  () => {
    const circuit155 = (dataset01 as Record<string, unknown>)
      .circuit155 as SimpleRouteJson

    const solver = new AutoroutingPipelineSolver4(structuredClone(circuit155))
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)

    const srjWithPointPairs = solver.srjWithPointPairs
    if (!srjWithPointPairs) {
      throw new Error("Solver did not produce point pairs SRJ")
    }

    const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()
    const circuitJson = convertToCircuitJson(
      srjWithPointPairs,
      simplifiedTraces,
      circuit155.minTraceWidth,
    )

    const { locationAwareErrors } = getDrcErrors(circuitJson, {
      traceClearance: 0.1,
      viaClearance: 0.1,
    })

    const viaTraceOverlaps = locationAwareErrors.filter((error) =>
      error.message.includes("overlaps with pcb_via"),
    )

    expect(viaTraceOverlaps).toHaveLength(0)
  },
  { timeout: 120_000 },
)
