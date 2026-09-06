import { expect, test } from "bun:test"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { ownedViaAndPad } from "./fixtures/ownedViaAndPad"

test("via-to-pad clearance reuses via trace ownership for a connected pad", () => {
  expect(
    getDrcErrors(ownedViaAndPad(0.45), {
      includeTraceContinuity: false,
      includeViaPadChecks: true,
    }).errors,
  ).toHaveLength(0)
})
