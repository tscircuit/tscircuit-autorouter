import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { getConnectionMinimumTraceWidthInput } from "../fixtures/connectionMinimumTraceWidthInput"

test("merged connections propagate their strongest minimum to every MST branch", async (): Promise<void> => {
  const input = getConnectionMinimumTraceWidthInput()
  input.connections.push({
    name: "POWER_TAP",
    minTraceWidth: 0.2,
    pointsToConnect: [
      { x: -11.4, y: 0, layer: "top", pointId: "left" },
      { x: -11.4, y: 5, layer: "top", pointId: "tap" },
    ],
  })
  input.obstacles.push({
    type: "rect",
    layers: ["top"],
    center: { x: -11.4, y: 5 },
    width: 0.8,
    height: 0.8,
    connectedTo: ["POWER_TAP"],
  })
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.srjWithPointPairs!.connections.length).toBeGreaterThan(1)
  expect(
    solver.srjWithPointPairs!.connections.every(
      (connection) => connection.minTraceWidth === 0.4,
    ),
  ).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces.length).toBeGreaterThan(1)
  const wires = traces.flatMap((trace) =>
    trace.route.filter((point) => point.route_type === "wire"),
  )
  expect(wires.length).toBeGreaterThan(0)
  expect(wires.every((point) => point.width >= 0.4 - 1e-6)).toBe(true)
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
      drcOptions: { includeTraceContinuity: false, traceClearance: 0.13 },
    }).replace(
      "</svg>",
      '<text x="24" y="85" font-size="15">Merged branch minima 0.40 / 0.20 mm: all new copper at least 0.40 mm</text></svg>',
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
