import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("Pipeline9 silently narrows a requested 0.4mm trace in a 0.5mm gap", async (): Promise<void> => {
  // Reduced from a TSCircuit board with <trace thickness="0.4mm">. Core
  // sends the source minimum as nominalTraceWidth; SRJ has no per-connection
  // minimum, so Pipeline9 is currently free to shrink to the board minimum.
  // A 0.4mm trace plus 0.13mm clearance on each side needs a 0.66mm gap,
  // greater than the 0.50mm gap between the two unrelated pads here.
  const input: SimpleRouteJson = {
    bounds: { minX: -7, maxX: 7, minY: -3, maxY: 3 },
    layerCount: 1,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.13,
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -5, y: 0 },
        width: 0.2,
        height: 0.15,
        connectedTo: ["WIDE_POWER"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 5, y: 0 },
        width: 0.2,
        height: 0.15,
        connectedTo: ["WIDE_POWER"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 1.425 },
        width: 13.2,
        height: 2.35,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: -1.425 },
        width: 13.2,
        height: 2.35,
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "WIDE_POWER",
        nominalTraceWidth: 0.4,
        pointsToConnect: [
          { x: -5, y: 0, layer: "top", pointId: "left" },
          { x: 5, y: 0, layer: "top", pointId: "right" },
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
  const traces = solver.getOutputSimplifiedPcbTraces()
  const interiorWidths = traces.flatMap((trace) =>
    trace.route.flatMap((point) =>
      point.route_type === "wire" && Math.abs(point.x) < 2
        ? [point.width]
        : [],
    ),
  )
  expect(interiorWidths.length).toBeGreaterThan(0)
  expect(Math.max(...interiorWidths)).toBeLessThan(0.4)

  // This is the actual routed copper, not a manually drawn expected route.
  const graphics = convertSrjToGraphicsObject({ ...input, traces })
  graphics.texts = [
    ...(graphics.texts ?? []),
    {
      x: -6,
      y: 2.82,
      text: "REQUESTED 0.40mm / GAP 0.50mm",
      fontSize: 0.32,
      color: "black",
      anchorSide: "center_left",
    },
    {
      x: -6,
      y: -2.82,
      text: `ROUTED CENTER ${Math.max(...interiorWidths).toFixed(4)}mm / NO ERROR`,
      fontSize: 0.32,
      color: "#b91c1c",
      anchorSide: "center_left",
    },
  ]
  await expect(graphics).toMatchGraphicsSvg(import.meta.path)
})
