import { expect, test } from "bun:test"
import type { PcbVia } from "circuit-json"
import { getDrcErrors } from "lib/testing/getDrcErrors"

test("getDrcErrors rejects via copper overlap despite sufficient drill spacing", (): void => {
  const vias: PcbVia[] = [
    {
      type: "pcb_via",
      pcb_via_id: "via_a",
      x: 0,
      y: 0,
      outer_diameter: 0.3,
      hole_diameter: 0.15,
      layers: ["top", "bottom"],
    },
    {
      type: "pcb_via",
      pcb_via_id: "via_b",
      x: 0.25,
      y: 0,
      outer_diameter: 0.3,
      hole_diameter: 0.15,
      layers: ["top", "bottom"],
    },
  ]
  const drillGap =
    vias[1].x - vias[0].x - (vias[0].hole_diameter + vias[1].hole_diameter) / 2
  expect(drillGap).toBeCloseTo(0.1)

  const { errors } = getDrcErrors(vias)
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    type: "pcb_via_clearance_error",
    pcb_via_ids: ["via_a", "via_b"],
    actual_clearance: expect.closeTo(-0.05),
  })
})
