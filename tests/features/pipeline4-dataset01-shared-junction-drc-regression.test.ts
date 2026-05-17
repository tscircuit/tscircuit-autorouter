import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

const circuits = ["circuit004", "circuit013", "circuit186"] as const

test(
  "pipeline4 dataset01 shared-junction fallback does not introduce DRC errors",
  () => {
    for (const circuitName of circuits) {
      const circuit = (dataset01 as Record<string, unknown>)[
        circuitName
      ] as SimpleRouteJson
      const solver = new AutoroutingPipelineSolver4(structuredClone(circuit))

      solver.solve()

      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)

      const srjWithPointPairs = solver.srjWithPointPairs
      if (!srjWithPointPairs) {
        throw new Error(`${circuitName} did not produce point pairs SRJ`)
      }

      const circuitJson = convertToCircuitJson(
        srjWithPointPairs,
        solver.getOutputSimplifiedPcbTraces(),
        {
          minTraceWidth: circuit.minTraceWidth,
          minViaDiameter: circuit.minViaDiameter,
        },
      )

      const { errors } = getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS)
      expect(errors, circuitName).toHaveLength(0)
    }
  },
  { timeout: 120_000 },
)
