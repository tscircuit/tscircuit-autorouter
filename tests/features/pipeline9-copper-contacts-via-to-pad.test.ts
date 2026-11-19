import { expect, test } from "bun:test"
import type { SimplifiedPcbTrace } from "lib/types"
import {
  findBoardCopperContacts,
  trace,
  via,
  wire,
} from "tests/fixtures/pipeline9CopperContactBoard"

test("pipeline9 copper contacts name the pad and owning trace of a via on another net's pad", () => {
  // netB drops a via at viaY beside netA's left pad, whose top edge is y=0.2.
  const traceBWithViaAt = (viaY: number): SimplifiedPcbTrace =>
    trace("tB", "netB", [
      wire(-3, 1),
      wire(-2.95, viaY),
      via(-2.95, viaY, "top", "bottom"),
      wire(-2.95, viaY, "bottom"),
      wire(3, 1, "bottom"),
      via(3, 1, "bottom", "top"),
      wire(3, 1),
    ])

  // The 0.3mm via reaches y=0.15, overlapping the pad.
  expect(findBoardCopperContacts([traceBWithViaAt(0.3)])).toEqual([
    ["pcb_smtpad_-3.000_0.000", "tB"],
  ])
  // Reaching only y=0.25 is a clearance violation, not a contact.
  expect(findBoardCopperContacts([traceBWithViaAt(0.4)])).toEqual([])
})
