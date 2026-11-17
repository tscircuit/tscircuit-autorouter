import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { checkTracesAreContiguous } from "@tscircuit/checks"
import { renderSepicRepro } from "../../fixtures/repro/sepic-converter/render"

// Render the original circuit TSX, including its eight manual traces.
// The pinned Core generates routing input; this repository's Pipeline 9 routes it.
test("pipeline9 preserves existing copper without introducing a clearance violation", async (): Promise<void> => {
  const { input, solver, circuitJson } = await renderSepicRepro()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(checkTracesAreContiguous(circuitJson)).toEqual([])
  const errors = circuitJson.filter(
    (element) => element.type === "pcb_trace_error",
  )
  expect(errors).toEqual([])
  expect(input.minTraceToPadEdgeClearance).toBe(0.1)
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
    `<rect x="12" y="12" width="330" height="44" rx="6" fill="white" stroke="#166534"/>
    <text x="24" y="40" font-family="sans-serif" font-size="20" fill="#166534">Core trace DRC errors: ${errors.length}</text></svg>`,
  )
  await expect(labeledBoard).toMatchSvgSnapshot(import.meta.path)

  for (const [traceId, width] of [
    ["source_net_8_mst1_0", 0.15],
    ["source_net_7_mst0_0", 0.2],
  ] as const) {
    const trace = solver
      .getOutputSimplifiedPcbTraces()
      .find((trace) => trace.pcb_trace_id === traceId)!
    const wires = trace.route.filter((point) => point.route_type === "wire")
    expect(wires.length).toBeGreaterThan(1)
    expect(
      wires.every(
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
    center: { x: -5.5, y: -5.8 },
    width: 4,
    height: 4,
    num_layers: 2,
    thickness: 1.6,
    material: "fr4",
  })
  const focusedSvg = convertCircuitJsonToPcbSvg(focusedCircuit, {
    width: 1000,
    height: 1000,
    backgroundColor: "white",
    colorOverrides: { copper: { top: "#dc2626", bottom: "#2563eb" } },
    drawPaddingOutsideBoard: false,
    renderSolderMask: false,
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
  })
  const labeledFocus = focusedSvg.replace(
    "</svg>",
    `<rect x="0" y="0" width="1000" height="100" fill="white"/>
    <text x="500" y="35" text-anchor="middle" font-family="sans-serif" font-size="25" fill="#166534">VCC / GATE — no trace clearance errors</text>
    <text x="500" y="72" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#334155">VCC: bottom (blue); GATE: top (red); required clearance: ${input.minTraceToPadEdgeClearance} mm</text></svg>`,
  )
  await expect(labeledFocus).toMatchSvgSnapshot(import.meta.path, {
    svgName: "bottom-clearance",
    scale: 1,
  })
})
