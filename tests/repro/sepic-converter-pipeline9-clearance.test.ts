import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { checkTracesAreContiguous } from "@tscircuit/checks"
import { renderSepicRepro } from "../../fixtures/repro/sepic-converter/render"
import { getMinimumTraceGap } from "tests/fixtures/getMinimumTraceGap"

// Render the original circuit TSX, including its eight manual traces.
// The pinned Core generates routing input; this repository's Pipeline 9 routes it.
test("repro: pipeline9 finishes the SEPIC board with insufficient trace clearance", async (): Promise<void> => {
  const { input, solver, circuitJson } = await renderSepicRepro()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(checkTracesAreContiguous(circuitJson)).toEqual([])
  const errors = circuitJson.filter(
    (element) => element.type === "pcb_trace_error",
  )
  expect(errors).toHaveLength(1)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const vcc = traces.find(
    (trace) => trace.pcb_trace_id === "source_net_8_mst1_0",
  )
  const gate = traces.find(
    (trace) => trace.pcb_trace_id === "source_net_7_mst0_0",
  )
  if (!vcc || !gate) throw new Error("Missing routed VCC or GATE trace")
  const gap = getMinimumTraceGap(vcc, gate)
  expect(gap).toBeLessThan(input.minTraceToPadEdgeClearance!)
  for (const [trace, width] of [
    [vcc, 0.15],
    [gate, 0.2],
  ] as const) {
    const wires = trace.route.filter((point) => point.route_type === "wire")
    expect(wires.length).toBeGreaterThan(1)
    expect(wires.every((point) => point.width === width)).toBe(true)
  }
  const color = errors.length === 0 ? "#166534" : "#b91c1c"
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
    `<rect x="12" y="12" width="330" height="44" rx="6" fill="white" stroke="${color}"/>
    <text x="24" y="40" font-family="sans-serif" font-size="20" fill="${color}">Core trace DRC errors: ${errors.length}</text></svg>`,
  )
  await expect(labeledBoard).toMatchSvgSnapshot(import.meta.path)

  // Keep surrounding pads and copper in a fixed 6 x 4 mm frame on both sides.
  const focusedCircuit: AnyCircuitElement[] = circuitJson.filter(
    (element) => element.type !== "pcb_board",
  )
  focusedCircuit.push({
    type: "pcb_board",
    pcb_board_id: "sepic_clearance_detail",
    center: { x: -5.25, y: -5.5 },
    width: 6,
    height: 4,
    num_layers: 2,
    thickness: 1.6,
    material: "fr4",
  })
  const focusedSvg = convertCircuitJsonToPcbSvg(focusedCircuit, {
    width: 1000,
    height: 800,
    backgroundColor: "white",
    colorOverrides: { copper: { top: "#dc2626", bottom: "#2563eb" } },
    drawPaddingOutsideBoard: false,
    renderSolderMask: false,
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
  })
  const vias = circuitJson.filter((element) => element.type === "pcb_via")
  const labeledFocus = focusedSvg.replace(
    "</svg>",
    `<rect x="0" y="0" width="1000" height="110" fill="white"/>
    <text x="500" y="32" text-anchor="middle" font-family="sans-serif" font-size="25" fill="#334155">SEPIC — VCC / GATE with surrounding native copper</text>
    <text x="500" y="66" text-anchor="middle" font-family="sans-serif" font-size="24" fill="${color}">Same-layer gap: ${gap.toFixed(3)} mm; required: ${input.minTraceToPadEdgeClearance} mm</text>
    <text x="500" y="96" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#334155">Top red · bottom blue · board vias: ${vias.length} · trace DRC errors: ${errors.length}</text></svg>`,
  )
  await expect(labeledFocus).toMatchSvgSnapshot(import.meta.path, {
    svgName: "bottom-clearance",
    scale: 1,
  })
})
