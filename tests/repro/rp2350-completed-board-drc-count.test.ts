import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

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

const compressedBoard = readFileSync(
  new URL("./assets/rp2350-completed-board.circuit.json.gz", import.meta.url),
)
const completedBoard = JSON.parse(
  gunzipSync(
    new Uint8Array(
      compressedBoard.buffer as ArrayBuffer,
      compressedBoard.byteOffset,
      compressedBoard.byteLength,
    ),
  ).toString("utf8"),
) as AnyCircuitElement[]

test("completed RP2350 board records the 13 routed DRC errors", (): void => {
  const drcErrors = completedBoard.filter(
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
