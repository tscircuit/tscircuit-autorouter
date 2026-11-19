import { expect, test } from "bun:test"
import {
  findBoardCopperContacts,
  trace,
  via,
  wire,
} from "tests/fixtures/pipeline9CopperContactBoard"

test("pipeline9 copper contacts name a via by its trace, not its per-run via id", () => {
  const traceA = trace("tA", "netA", [
    wire(-3, 0),
    wire(0, 0),
    via(0, 0, "top", "bottom"),
    wire(0, 0, "bottom"),
    wire(3, 0, "bottom"),
    via(3, 0, "bottom", "top"),
    wire(3, 0),
  ])
  // netB's top-layer detour clips tA's via barrel at (0, 0) and nothing else.
  const traceB = trace("tB", "netB", [
    wire(-3, 1),
    wire(0.2, 1),
    wire(0.2, -0.1),
    wire(0.6, -0.1),
    wire(0.6, 1),
    wire(3, 1),
  ])
  // netC detours through two vias far from the contact. Listed first, its
  // vias take the lowest via ids, so tA's via gets a different id.
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

  expect(findBoardCopperContacts([traceA, traceB])).toEqual([["tA", "tB"]])
  expect(findBoardCopperContacts([traceC, traceA, traceB])).toEqual([
    ["tA", "tB"],
  ])
})
