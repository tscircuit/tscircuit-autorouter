import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import completedBoard from "../../fixtures/repro/rp2350-complete-board-drc/rp2350-completed-board.circuit.json" with {
  type: "json",
}

type CapturedDrcError = AnyCircuitElement & {
  type: string
  message: string
}

const drcErrorTypes = new Set([
  "pcb_trace_error",
  "pcb_pad_trace_clearance_error",
  "pcb_via_trace_clearance_error",
  "pcb_pad_pad_clearance_error",
])

test("completed RP2350 board records the 13 routed DRC errors", (): void => {
  const drcErrors = (completedBoard as AnyCircuitElement[]).filter(
    (element): element is CapturedDrcError =>
      drcErrorTypes.has(element.type) &&
      "message" in element &&
      typeof element.message === "string",
  )
  const errorCountByType = Object.fromEntries(
    [...drcErrorTypes].map((type) => [
      type,
      drcErrors.filter((error) => error.type === type).length,
    ]),
  )

  expect(drcErrors).toHaveLength(13)
  expect(errorCountByType).toEqual({
    pcb_trace_error: 3,
    pcb_pad_trace_clearance_error: 2,
    pcb_via_trace_clearance_error: 4,
    pcb_pad_pad_clearance_error: 4,
  })
  expect(
    drcErrors.some((error) => error.message.includes("accidental contact")),
  ).toBeTrue()
})
