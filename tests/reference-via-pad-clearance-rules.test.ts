import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import {
  issue3130Input,
  issue3130Traces,
} from "./fixtures/issue3130-via-pad-clearance"

test("reference via-pad DRC honors copper rules independently of trace and drill rules", (): void => {
  const cases: Array<{
    rules: Partial<SimpleRouteJson>
    minimum?: number
    errorCount: number
  }> = [
    {
      rules: { minPadEdgeToPadEdgeClearance: 0.2 },
      minimum: 0.2,
      errorCount: 1,
    },
    {
      rules: {
        minPadEdgeToPadEdgeClearance: undefined,
        minViaEdgeToPadEdgeClearance: 0.25,
      },
      minimum: 0.25,
      errorCount: 1,
    },
    {
      rules: {
        minPadEdgeToPadEdgeClearance: 0.25,
        minViaEdgeToPadEdgeClearance: 0.1,
      },
      minimum: 0.25,
      errorCount: 1,
    },
    {
      rules: {
        minPadEdgeToPadEdgeClearance: 0.1,
        minViaEdgeToPadEdgeClearance: 0.2,
        minViaHoleEdgeToViaHoleEdgeClearance: 0.3,
        minTraceToPadEdgeClearance: 0.05,
      },
      minimum: 0.2,
      errorCount: 1,
    },
    { rules: { minPadEdgeToPadEdgeClearance: 0.15 }, errorCount: 0 },
    {
      rules: {
        minPadEdgeToPadEdgeClearance: 0,
        minViaEdgeToPadEdgeClearance: 0,
      },
      errorCount: 0,
    },
  ]
  for (const { rules, minimum, errorCount } of cases) {
    const input = { ...structuredClone(issue3130Input), ...rules }
    input.connections = input.connections.slice(0, 1)
    input.obstacles = input.obstacles.slice(0, 1)
    const traces = structuredClone(issue3130Traces.slice(0, 1))
    // Candidate scoring often omits the board element. Both evaluator paths
    // must still honor the input's declared copper rules.
    for (const includeBoardClearance of [false, true]) {
      const drc = evaluateRelaxedDrc({
        inputSrj: input,
        srjWithPointPairs: input,
        routedTraces: traces,
        includeBoardClearance,
        drcOptions: {
          traceClearance: input.minTraceToPadEdgeClearance,
          viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance,
        },
      })
      expect(drc.errors).toHaveLength(errorCount)
      if (errorCount > 0) {
        expect(drc.errors[0]).toMatchObject({
          type: "pcb_pad_pad_clearance_error",
          minimum_clearance: minimum,
        })
        expect(
          (drc.errors[0] as { actual_clearance: number }).actual_clearance,
        ).toBeCloseTo(0.15, 9)
      }
    }
  }
})
