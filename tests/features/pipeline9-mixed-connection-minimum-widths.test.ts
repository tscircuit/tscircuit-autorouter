import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { getConnectionMinimumTraceWidthInput } from "../fixtures/connectionMinimumTraceWidthInput"

test("a 0.40mm connection detours while a 0.10mm connection uses the narrow channel", async (): Promise<void> => {
  const input = getConnectionMinimumTraceWidthInput()
  input.connections.push({
    name: "SENSE", minTraceWidth: 0.1, nominalTraceWidth: 0.1,
    pointsToConnect: [{ x: -9, y: 0, layer: "top" }, { x: 9, y: 0, layer: "top" }],
  })
  for (const x of [-9, 9]) {
    input.obstacles.push({ type: "rect", layers: ["top"], center: { x, y: 0 },
      width: 0.3, height: 0.12, connectedTo: ["SENSE"] })
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  for (const [name, width] of [["WIDE_POWER", 0.4], ["SENSE", 0.1]] as const) {
    const wires = traces.filter((trace) => trace.connection_name === name)
      .flatMap((trace) => trace.route.filter((point) => point.route_type === "wire"))
    expect(wires.length).toBeGreaterThan(0)
    expect(wires.every((point) => point.width >= width - 1e-6)).toBe(true)
    if (name === "SENSE") {
      expect(wires.every((point) => Math.abs(point.y) < 0.1)).toBe(true)
      expect(wires.every((point) => Math.abs(point.width - 0.1) < 1e-6)).toBe(true)
    } else expect(wires.some((point) => Math.abs(point.y) > 2.9)).toBe(true)
  }
  // This reduced SRJ has no Circuit JSON port records. Verify terminal joins
  // geometrically, then evaluate the board's declared copper-clearance rules.
  for (const connection of input.connections) {
    for (const terminal of connection.pointsToConnect) {
      expect(traces.some((trace) => trace.connection_name === connection.name && trace.route.some((point) => point.route_type === "wire" && point.layer === terminal.layer && Math.hypot(point.x - terminal.x, point.y - terminal.y) < 1e-6))).toBe(true)
    }
  }
  const result = { inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: traces,
    drcOptions: { includeTraceContinuity: false, traceClearance: 0.13 } }
  expect(evaluateRelaxedDrc(result).errors).toEqual([])
  await expect(getBugReportSnapshotSvg(result).replace("</svg>", '<text x="24" y="85" font-size="15">POWER minimum 0.40 mm; SENSE minimum 0.10 mm</text></svg>')).toMatchSvgSnapshot(import.meta.path)
})
