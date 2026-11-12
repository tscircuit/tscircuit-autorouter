// As a PCB designer, I want an ordered 1-hop path to retain its exact pads
// even when a closer pad is electrically equivalent off-board.
import { test } from "bun:test"
import { checkOrderedTraceOffboardPads } from "../fixtures/check-ordered-trace-offboard-pads"

test("ordered 1-hop path keeps its declared pads despite closer off-board equivalents", (): void => {
  checkOrderedTraceOffboardPads(1)
})
