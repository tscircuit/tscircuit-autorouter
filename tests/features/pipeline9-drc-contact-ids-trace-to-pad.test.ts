import { expect, test } from "bun:test"
import {
  getBoardContactIds,
  trace,
  wire,
} from "tests/fixtures/pipeline9CopperContactBoard"

test("pipeline9 DRC names the trace and pad in contact_ids when a trace runs over another net's pad", () => {
  // netB dips onto netA's left pad at (-3, 0) before heading to its own end.
  const traceB = trace("tB", "netB", [
    wire(-3, 1),
    wire(-3, 0.05),
    wire(-2.5, 0.6),
    wire(3, 1),
  ])

  expect(getBoardContactIds([traceB])).toEqual([
    ["pcb_smtpad_-3.000_0.000", "tB"],
  ])
})
