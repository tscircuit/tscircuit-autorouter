import { expect, test } from "bun:test"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { ownedViaAndPad } from "./fixtures/ownedViaAndPad"

test("opt-in catches a same-net via inside its pad without changing default checks", () => {
  const circuitJson = ownedViaAndPad(0)
  const options = { includeTraceContinuity: false }
  expect(getDrcErrors(circuitJson, options).errors).toHaveLength(0)
  expect(
    getDrcErrors(circuitJson, { ...options, includeViaPadChecks: false })
      .errors,
  ).toHaveLength(0)
  const result = getDrcErrors(circuitJson, {
    ...options,
    includeViaPadChecks: true,
  })
  expect(result.errors).toHaveLength(1)
  expect(result.locationAwareErrors).toEqual([
    expect.objectContaining({
      type: "pcb_placement_error",
      pcb_placement_error_id: "via_in_pad_via_a_pad_a",
      center: { x: 0, y: 0 },
    }),
  ])
})
