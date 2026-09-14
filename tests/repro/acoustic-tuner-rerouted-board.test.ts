import { expect, test } from "bun:test"
import { checkCopperToBoardEdgeClearance } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import input from "../../fixtures/repro/acoustic-tuner-board-edge-clearance/input.srj.json"

test("captured acoustic tuner reroute records one copper-to-board edge violation", async (): Promise<void> => {
  const compressedBoard = readFileSync(
    new URL(
      "./assets/acoustic-tuner-rerouted-board.circuit.json.gz",
      import.meta.url,
    ),
  )
  const circuit = JSON.parse(
    gunzipSync(new Uint8Array(compressedBoard)).toString("utf8"),
  ) as AnyCircuitElement[]
  const board = circuit.find((element) => element.type === "pcb_board")
  if (!board) throw new Error("Captured reroute has no board")
  expect(board.outline).toEqual(input.outline)
  expect(board.min_board_edge_clearance).toBe(input.minBoardEdgeClearance)
  expect(
    circuit.filter((element) => element.type === "pcb_trace"),
  ).toHaveLength(71)
  expect(circuit.filter((element) => element.type === "pcb_via")).toHaveLength(
    60,
  )

  // Use the board's declared rule, not the benchmark relaxed-DRC preset.
  const errors = checkCopperToBoardEdgeClearance(circuit)
  expect(errors).toHaveLength(1)
  expect(errors[0].message).toContain("measured 0.261mm, required 0.300mm")
  const via = circuit.find(
    (element) =>
      element.type === "pcb_via" &&
      errors[0].pcb_placement_error_id ===
        `copper_too_close_to_board_edge_${element.pcb_via_id}`,
  )
  if (!via || via.type !== "pcb_via") throw new Error("Missing violating via")
  expect(via.pcb_trace_id).toBe("source_trace_67_0")
  expect(via.x).toBeCloseTo(-3.9388401191, 6)
  expect(via.y).toBeCloseTo(17.1943297209, 6)

  await expect(
    convertCircuitJsonToPcbSvg(circuit, {
      backgroundColor: "white",
      height: 1200,
      matchBoardAspectRatio: true,
      shouldDrawErrors: false,
      colorOverrides: {
        silkscreen: { top: "#334155", bottom: "#64748b" },
        boardOutline: "#334155",
      },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
