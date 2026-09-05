import { expect, test } from "bun:test"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { ownedViaAndPad } from "./fixtures/ownedViaAndPad"

test("opt-in catches an unconnected near-pad via and honors the clearance option", () => {
  const circuitJson = ownedViaAndPad(0.45).filter((e) => e.type !== "pcb_trace")
  expect(getDrcErrors(circuitJson).errors).toHaveLength(0)
  const result = getDrcErrors(circuitJson, { includeViaPadChecks: true })
  expect(result.errors).toHaveLength(1)
  expect(result.locationAwareErrors[0]).toMatchObject({
    type: "pcb_pad_pad_clearance_error",
    center: { x: 0.225, y: 0 },
  })
  expect(
    getDrcErrors(circuitJson, {
      includeViaPadChecks: true,
      traceClearance: 0.04,
    }).errors,
  ).toHaveLength(0)
})
