import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

test("Pipeline9 keeps a 0.4mm trace at nominal width around a blocked corridor", async (): Promise<void> => {
  // A 0.4mm trace needs a 0.66mm corridor including clearance; the 0.50mm
  // gap is too narrow, so nominal-width expansion must take a legal detour.
  const input: SimpleRouteJson = {
    bounds: { minX: -15, maxX: 15, minY: -10, maxY: 10 },
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
        nominalTraceWidth: 0.4,
        pointsToConnect: [
          { x: -11.4, y: 0, layer: "top", pointId: "left" },
          { x: 11.4, y: 0, layer: "top", pointId: "right" },
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
  const wirePoints = traces.flatMap((trace) =>
    trace.route.filter((point) => point.route_type === "wire"),
  )
  expect(wirePoints.length).toBeGreaterThan(0)
  expect(wirePoints.every((point) => point.width >= 0.4 - 1e-6)).toBe(true)
  expect(wirePoints.some((point) => Math.abs(point.y) > 2.9)).toBe(true)

  // Raising the board minimum to 0.4mm must retain the same full-width behavior.
  const controlInput: SimpleRouteJson = { ...input, minTraceWidth: 0.4 }
  const controlSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    controlInput,
    { cacheProvider: null },
  )
  controlSolver.solve()
  expect(controlSolver.solved).toBe(true)
  expect(controlSolver.failed).toBe(false)
  const controlTraces = controlSolver.getOutputSimplifiedPcbTraces()
  const controlWires = controlTraces.flatMap((trace) =>
    trace.route.filter((point) => point.route_type === "wire"),
  )
  expect(controlWires.every((point) => point.width >= 0.4 - 1e-6)).toBe(true)
  expect(
    controlWires.some(
      (point) => point.width === 0.4 && Math.abs(point.y) > 2.9,
    ),
  ).toBe(true)
  expect(controlWires.every((point) => Math.abs(point.y) < 4.5)).toBe(true)

  const boardOutline = {
    center: { x: 0, y: 0 },
    width: 30,
    height: 20,
    fill: "none",
    stroke: "gray",
  }
  const routedGraphics = convertSrjToGraphicsObject({ ...input, traces })
  const controlGraphics = convertSrjToGraphicsObject({
    ...controlInput,
    traces: controlTraces,
  })
  routedGraphics.rects.push(boardOutline)
  controlGraphics.rects.push(boardOutline)

  // Both panels are produced from real solver output, not hand-drawn routes.
  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "NOMINAL 0.40mm: legal detour with board min 0.10mm",
          pipeline: "end",
          graphics: routedGraphics,
        },
        {
          name: "CONTROL: board min 0.40mm, legal detour",
          pipeline: "end",
          graphics: controlGraphics,
        },
      ],
      columns: 1,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
