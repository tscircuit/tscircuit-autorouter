import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { checkTracesAreContiguous } from "@tscircuit/checks"
import { renderSepicRepro } from "../../fixtures/repro/sepic-converter/render"

// Render the original circuit TSX, including its eight manual traces.
// The pinned Core generates routing input; this repository's Pipeline 9 routes it.
test("repro: pipeline9 finishes the SEPIC board with insufficient trace clearance", async (): Promise<void> => {
  const { input, solver, circuitJson } = await renderSepicRepro()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(checkTracesAreContiguous(circuitJson)).toEqual([])
  const errors = circuitJson.filter((element) => element.type === "pcb_trace_error")
  expect(errors).toHaveLength(1)
  const clearanceError = errors[0]
  if (
    !clearanceError ||
    !("center" in clearanceError) ||
    clearanceError.center?.x === undefined ||
    clearanceError.center.y === undefined
  ) {
    throw new Error("Expected the reproduced VCC–GATE clearance error")
  }
  // Reproduction assertion: replace with a clean-DRC assertion when fixed.
  expect(clearanceError.message).toContain("gap: 0.053mm")
  expect(input.minTraceToPadEdgeClearance).toBe(0.1)
  expect(clearanceError.message).toContain(".U1 > .VIN to net.VCC")
  expect(clearanceError.message).toContain(".Q1 > .G to .R7 > .pin1")
  const boardSvg = convertCircuitJsonToPcbSvg(circuitJson, {
    width: 1000,
    height: 800,
    backgroundColor: "white",
    colorOverrides: { silkscreen: { top: "#6b6300", bottom: "#6b6300" } },
    shouldDrawRatsNest: false,
    includeVersion: false,
  })
  const labeledBoard = boardSvg.replace(
    "</svg>",
    `<rect x="12" y="12" width="330" height="44" rx="6" fill="white" stroke="#b91c1c"/>
    <text x="24" y="40" font-family="sans-serif" font-size="20" fill="#b91c1c">Core trace DRC errors: ${errors.length}</text></svg>`,
  )
  await expect(labeledBoard).toMatchSvgSnapshot(import.meta.path)

  for (const [traceId, width] of [
    ["source_net_8_mst1_0", 0.15],
    ["source_net_7_mst0_0", 0.2],
  ] as const) {
    const trace = solver.getOutputSimplifiedPcbTraces().find(
      (trace) => trace.pcb_trace_id === traceId,
    )!
    const bottomWires = trace.route.filter(
      (point) => point.route_type === "wire" && point.layer === "bottom",
    )
    expect(bottomWires.length).toBeGreaterThan(1)
    expect(
      bottomWires.every(
        (point) => point.route_type === "wire" && point.width === width,
      ),
    ).toBe(true)
  }

  // Crop the emitted copper, without changing its geometry or widths.
  const focusedCircuit: AnyCircuitElement[] = circuitJson.filter((element) => {
    if (element.type === "pcb_trace") {
      return ["source_net_8_mst1_0", "source_net_7_mst0_0"].includes(
        element.pcb_trace_id,
      )
    }
    return element.type === "pcb_via"
  })
  focusedCircuit.push({
    type: "pcb_board",
    pcb_board_id: "sepic_clearance_detail",
    center: { x: clearanceError.center.x, y: clearanceError.center.y },
    width: 2,
    height: 2,
    num_layers: 2,
    thickness: 1.6,
    material: "fr4",
  })
  const focusedSvg = convertCircuitJsonToPcbSvg(focusedCircuit, {
    width: 1000,
    height: 1000,
    layer: "bottom",
    backgroundColor: "white",
    colorOverrides: { copper: { bottom: "#2563eb" } },
    drawPaddingOutsideBoard: false,
    renderSolderMask: false,
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
  })
  const gap = clearanceError.message.match(/gap: ([\d.]+)mm/)![1]
  const labeledFocus = focusedSvg.replace(
    "</svg>",
    `<rect x="0" y="0" width="1000" height="110" fill="white"/>
    <text x="500" y="32" text-anchor="middle" font-family="sans-serif" font-size="25" fill="#334155">SEPIC — bottom copper: VCC / GATE</text>
    <text x="500" y="66" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#b91c1c">DRC reported gap: ${gap} mm; required: ${input.minTraceToPadEdgeClearance} mm</text>
    <circle cx="500" cy="500" r="65" fill="none" stroke="#d97706" stroke-width="3" stroke-dasharray="8 5"/>
    <text x="260" y="370" font-family="sans-serif" font-size="28" fill="#111827" stroke="white" stroke-width="5" paint-order="stroke">VCC</text>
    <text x="750" y="610" font-family="sans-serif" font-size="28" fill="#111827" stroke="white" stroke-width="5" paint-order="stroke">GATE</text>
    <text x="500" y="96" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#334155">VCC: U1.VIN–C5.1 (0.15 mm); GATE: R4.2–R7.1 (0.20 mm)</text></svg>`,
  )
  await expect(labeledFocus).toMatchSvgSnapshot(import.meta.path, {
    svgName: "bottom-clearance",
    scale: 1,
  })
})
