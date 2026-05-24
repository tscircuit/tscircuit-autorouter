import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver } from "lib/autorouter-pipelines"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

const circuit15 = (dataset01 as Record<string, unknown>)
  .circuit015 as SimpleRouteJson

test(
  "circuit015 avoids accidental-contact overlaps after autorouting",
  () => {
    const solver = new AutoroutingPipelineSolver(circuit15, {
      effort: 4,
    })

    solver.solve()

    expect(solver.failed).toBe(false)

    const srjWithPointPairs = solver.srjWithPointPairs
    if (!srjWithPointPairs) {
      throw new Error("Solver did not produce point pairs SRJ")
    }

    const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()
    const circuitJson = convertToCircuitJson(
      srjWithPointPairs,
      simplifiedTraces,
      { minTraceWidth: circuit15.minTraceWidth },
    )

    const { locationAwareErrors } = getDrcErrors(circuitJson)
    const accidentalContacts = locationAwareErrors.filter((e) =>
      e.message.includes("accidental contact"),
    )

    expect(accidentalContacts.length).toBe(0)
  },
  { timeout: 120_000 },
)
