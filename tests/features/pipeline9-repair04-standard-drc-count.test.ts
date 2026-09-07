import { expect, test } from "bun:test"
import {
  getStandardDrcErrorCount,
  isSupplementaryViaPadError,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getStandardDrcErrorCount"

test("only supplemental via-pad identities are excluded from standard count", (): void => {
  const supplemental = [
    {
      type: "pcb_placement_error",
      pcb_placement_error_id: "via_in_pad_opaque_via_opaque_pad",
    },
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_pad_clearance_error_id: "via_pad_clearance_opaque_via_pad",
    },
  ]
  const standard = [
    { type: "pcb_trace_error" },
    { type: "pcb_via_trace_clearance_error" },
    { type: "pcb_pad_trace_clearance_error" },
    { type: "pcb_via_clearance_error" },
    { type: "new_unknown_error" },
    { type: "pcb_placement_error" },
    {
      type: "pcb_placement_error",
      pcb_placement_error_id: "out_of_board_via_a",
    },
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_pad_clearance_error_id: "pad_pad_clearance_a_b",
    },
    {
      type: "new_unknown_error",
      pcb_placement_error_id: "via_in_pad_a_b",
    },
    {
      type: "pcb_placement_error",
      pcb_placement_error_id: 123,
    },
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_pad_clearance_error_id: null,
    },
  ]
  const errors = [...standard, ...supplemental]
  const before = structuredClone(errors)
  expect(getStandardDrcErrorCount(errors)).toBe(standard.length)
  expect(getStandardDrcErrorCount([...errors].reverse())).toBe(standard.length)
  expect(getStandardDrcErrorCount([...errors, standard[0]!])).toBe(
    standard.length + 1,
  )
  expect(getStandardDrcErrorCount([])).toBe(0)
  for (const error of standard) {
    expect(isSupplementaryViaPadError(error)).toBe(false)
  }
  for (const error of supplemental) {
    expect(isSupplementaryViaPadError(error)).toBe(true)
  }
  // Expanded improvement 5→3 must not permit a standard increase 2→3.
  const current = [standard[0]!, standard[1]!, ...supplemental, supplemental[0]!]
  const candidate = standard.slice(0, 3)
  expect(candidate.length).toBeLessThan(current.length)
  expect(getStandardDrcErrorCount(candidate)).toBeGreaterThan(
    getStandardDrcErrorCount(current),
  )
  expect(errors).toEqual(before)
})
