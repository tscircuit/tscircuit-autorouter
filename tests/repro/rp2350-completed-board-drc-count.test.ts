import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTraceRoutePoint } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
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

// circuit-to-svg does not yet render the current through_pad route point
// shape. Expand it into its two layer endpoints only for this visual snapshot;
// the preserved Circuit JSON remains byte-for-byte unchanged.
const completedBoardForSnapshot = completedBoard.map(
  (element): AnyCircuitElement => {
    if (element.type !== "pcb_trace") return element
    const route = element.route.flatMap((point): PcbTraceRoutePoint[] =>
      point.route_type === "through_pad"
        ? [
            {
              route_type: "wire",
              x: point.start.x,
              y: point.start.y,
              width: point.width,
              layer: point.start_layer,
            },
            {
              route_type: "wire",
              x: point.end.x,
              y: point.end.y,
              width: point.width,
              layer: point.end_layer,
            },
          ]
        : [point],
    )
    return { ...element, route }
  },
)

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
  expect(
    convertCircuitJsonToPcbSvg(completedBoardForSnapshot, {
      backgroundColor: "#0f172a",
      height: 1200,
      matchBoardAspectRatio: true,
      shouldDrawErrors: false,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
