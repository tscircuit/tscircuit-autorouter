import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("width improvement retains the completed route when the wider trace cannot fit", (): void => {
  const input: SimpleRouteJson = {
    bounds: { minX: -15, maxX: 15, minY: -2.6, maxY: 2.6 },
    layerCount: 1,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.13,
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -11.4, y: 0 },
        width: 0.8,
        height: 0.8,
        connectedTo: ["WIDE_POWER"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 11.4, y: 0 },
        width: 0.8,
        height: 0.8,
        connectedTo: ["WIDE_POWER"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 1.425 },
        width: 20,
        height: 2.35,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: -1.425 },
        width: 20,
        height: 2.35,
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "WIDE_POWER",
        minTraceWidth: 0.4,
        pointsToConnect: [
          { x: -11.4, y: 0, layer: "top" },
          { x: 11.4, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    solver.hypergraphTraceWidthImprovementSolver?.stats.attemptedRouteCount,
  ).toBe(1)
  expect(
    solver.hypergraphTraceWidthImprovementSolver?.stats.improvedRouteCount,
  ).toBe(0)
  const wires = solver
    .getOutputSimplifiedPcbTraces()
    .flatMap((trace) =>
      trace.route.filter((point) => point.route_type === "wire"),
    )
  expect(wires.length).toBeGreaterThan(0)
  expect(wires.some((point) => point.width < 0.4)).toBe(true)
  expect(solver.traceWidthSolver?.widthWarnings).toContain(
    "Insufficient clearance for WIDE_POWER at the requested width: requested 0.4mm, used 0.1mm.",
  )
})
