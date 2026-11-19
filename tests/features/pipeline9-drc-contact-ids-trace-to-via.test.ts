import { expect, test } from "bun:test"
import {
  getBoardContactIds,
  trace,
  via,
  wire,
} from "tests/fixtures/pipeline9CopperContactBoard"

test("pipeline9 DRC names a via by its trace in contact_ids, not its per-run via id", () => {
  const traceA = trace("tA", "netA", [
    wire(-3, 0),
    wire(0, 0),
    via(0, 0, "top", "bottom"),
    wire(0, 0, "bottom"),
    wire(3, 0, "bottom"),
    via(3, 0, "bottom", "top"),
    wire(3, 0),
  ])
  // netB's top-layer detour clips tA's via barrel at (0, 0).
  const traceB = trace("tB", "netB", [
    wire(-3, 1),
    wire(0.2, 1),
    wire(0.2, -0.1),
    wire(0.6, -0.1),
    wire(0.6, 1),
    wire(3, 1),
  ])
  // Listed first, netC's two vias take the lowest via ids.
  const traceC = trace("tC", "netC", [
    wire(0, -2),
    wire(-4, -2),
    via(-4, -2, "top", "bottom"),
    wire(-4, -2, "bottom"),
    wire(-4, 2, "bottom"),
    via(-4, 2, "bottom", "top"),
    wire(-4, 2),
    wire(0, 2),
  ])

  expect(getBoardContactIds([traceA, traceB])).toEqual([["tA", "tB"]])
  expect(getBoardContactIds([traceC, traceA, traceB])).toEqual([["tA", "tB"]])
})
