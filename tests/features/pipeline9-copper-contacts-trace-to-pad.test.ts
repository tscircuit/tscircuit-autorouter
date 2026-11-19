import { expect, test } from "bun:test"
import {
  findBoardCopperContacts,
  trace,
  wire,
} from "tests/fixtures/pipeline9CopperContactBoard"

test("pipeline9 copper contacts name the pad a trace of another net runs over", () => {
  // netB dips onto netA's left pad at (-3, 0) before heading to its own end.
  const traceB = trace("tB", "netB", [
    wire(-3, 1),
    wire(-3, 0.05),
    wire(-2.5, 0.6),
    wire(3, 1),
  ])

  expect(findBoardCopperContacts([traceB])).toEqual([
    ["pcb_smtpad_-3.000_0.000", "tB"],
  ])
})
