import { expect, test } from "bun:test"
import { runAllRoutingChecks } from "@tscircuit/checks"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { createCoreDrcViaSpanFixture } from "tests/fixtures/core-drc-via-span-fixture"

test("physical through-via detection preserves Core's same-net contact exemption", async () => {
  const { srj, traces } = createCoreDrcViaSpanFixture({
    allowBlindAndBuriedVias: false,
    sameNet: true,
  })
  const circuitJson = convertToCircuitJson(srj, traces)
  expect(
    circuitJson.find((element) => element.type === "pcb_via")?.layers,
  ).toEqual(["top", "inner1", "inner2", "bottom"])
  const coreErrors = await runAllRoutingChecks(circuitJson)
  expect(coreErrors).toEqual([])
  expect(coreErrors).toEqual(getDrcErrors(circuitJson).errors)
})
