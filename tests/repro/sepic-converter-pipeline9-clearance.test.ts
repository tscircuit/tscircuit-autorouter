import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import inputFixture from "../../fixtures/repro/sepic-converter/sepic-converter.srj.json"

test("repro: pipeline9 finishes the SEPIC board with insufficient trace clearance", async (): Promise<void> => {
  const input = structuredClone(inputFixture) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const snapshotInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    drcOptions: { traceClearance: input.minTraceToPadEdgeClearance },
  }
  const { errors, circuitJson } = evaluateRelaxedDrc(snapshotInput)
  const clearanceError = errors.find(
    (error) =>
      error.type === "pcb_trace_error" &&
      error.pcb_trace_error_id ===
        "overlap_source_net_8_mst1_0_source_net_7_mst0_0",
  )
  if (
    !clearanceError ||
    !("center" in clearanceError) ||
    clearanceError.center?.x === undefined ||
    clearanceError.center.y === undefined
  ) {
    throw new Error("Expected the reproduced VCC–GATE clearance error")
  }
  // Reproduction assertion: replace with a clean-DRC assertion when fixed.
  expect(clearanceError.message).toContain("gap: 0.049mm")
  expect(input.minTraceToPadEdgeClearance).toBe(0.1)
  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
  )

  for (const [traceId, width] of [
    ["source_net_8_mst1_0", 0.15],
    ["source_net_7_mst0_0", 0.2],
  ] as const) {
    const trace = snapshotInput.routedTraces.find(
      (trace) => trace.pcb_trace_id === traceId,
    )!
    const bottomWires = trace.route.filter(
      (point) => point.route_type === "wire" && point.layer === "bottom",
    )
    expect(bottomWires.length).toBeGreaterThan(1)
    expect(bottomWires.every((point) => point.route_type === "wire" && point.width === width)).toBe(true)
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
    <text x="500" y="66" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#b91c1c">Gap: ${gap} mm; required: ${input.minTraceToPadEdgeClearance} mm</text>
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
