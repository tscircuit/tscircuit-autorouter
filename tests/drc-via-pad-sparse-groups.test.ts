import * as checks from "@tscircuit/checks"
import { expect, spyOn, test } from "bun:test"
import type { AnyCircuitElement, PcbVia } from "circuit-json"
import { getViaInPadErrorsWithCenters } from "lib/testing/getViaInPadErrorsWithCenters"
import { ownedViaAndPad } from "./fixtures/ownedViaAndPad"

test("sparse via placement checks preserve centers, duplicate IDs and pad order with fewer index builds", (): void => {
  const fixture = ownedViaAndPad(0)
  const baseVia = fixture.find(
    (element): element is PcbVia => element.type === "pcb_via",
  )!
  const pad = fixture.find(
    (element): element is Extract<AnyCircuitElement, { type: "pcb_smtpad" }> =>
      element.type === "pcb_smtpad",
  )!
  const context: AnyCircuitElement[] = [
    ...fixture.filter((element): boolean => element.type !== "pcb_via"),
    { ...pad, pcb_smtpad_id: "pad_overlapping" },
  ]
  for (const dense of [false, true]) {
    const vias: PcbVia[] = Array.from(
      { length: 128 },
      (_, index): PcbVia => ({
        ...baseVia,
        // Distinct physical vias can carry the same opaque ID. Their centers
        // and multiplicity must remain independent of error ID text.
        pcb_via_id: "via_opaque_pad_overlapping",
        x:
          dense || index === 3 || index === 109
            ? 0.01 * (index % 7)
            : index + 2,
        y: 0,
        layers: index === 109 ? ["bottom"] : ["top", "bottom"],
      }),
    )
    const circuitJson = [vias[0]!, ...context, ...vias.slice(1)]
    const before = structuredClone(circuitJson)
    const expected = vias.flatMap(
      (via): ReturnType<typeof getViaInPadErrorsWithCenters> =>
        checks
          .checkViasInPads([...context, via])
          .map(
            (
              error,
            ): ReturnType<typeof getViaInPadErrorsWithCenters>[number] => ({
              ...error,
              center: { x: via.x, y: via.y },
            }),
          ),
    )
    expect(expected.length).toBe(dense ? 254 : 2)
    const check = spyOn(checks, "checkViasInPads")
    try {
      expect(getViaInPadErrorsWithCenters(circuitJson)).toEqual(expected)
      expect(check.mock.calls.length).toBeLessThan(dense ? 160 : 40)
    } finally {
      check.mockRestore()
    }
    expect(circuitJson).toEqual(before)
  }
})
