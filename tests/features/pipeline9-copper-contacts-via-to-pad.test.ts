import { expect, test } from "bun:test"
import {
  findBoardCopperContacts,
  trace,
  via,
  wire,
} from "tests/fixtures/pipeline9CopperContactBoard"

test("pipeline9 copper contacts name the pad and owning trace of a via on another net's pad", () => {
  // netB drops a via onto the edge of netA's left pad at (-3, 0).
  const traceB = trace("tB", "netB", [
    wire(-3, 1),
    wire(-2.95, 0.3),
    via(-2.95, 0.3, "top", "bottom"),
    wire(-2.95, 0.3, "bottom"),
    wire(3, 1, "bottom"),
    via(3, 1, "bottom", "top"),
    wire(3, 1),
  ])

  expect(findBoardCopperContacts([traceB])).toEqual([
    ["pcb_smtpad_-3.000_0.000", "tB"],
  ])
})
