import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

test("Pipeline9 narrows a 0.4mm trace instead of taking a legal detour", async (): Promise<void> => {
  // Reduced from a TSCircuit board with <trace thickness="0.4mm">. Core
  // sends the source minimum as nominalTraceWidth; SRJ has no per-connection
  // minimum, so Pipeline9 is currently free to shrink to the board minimum.
  // A 0.4mm trace plus 0.13mm clearance on each side needs a 0.66mm gap,
  // greater than the 0.50mm gap between the two unrelated pads here. There
  // is room around either obstacle for a legal 0.4mm detour.
  const input: SimpleRouteJson = {
    bounds: { minX: -13.4, maxX: 13.4, minY: -4, maxY: 4 },
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
  const interiorWidths = traces.flatMap((trace) =>
    trace.route.flatMap((point) =>
      point.route_type === "wire" && Math.abs(point.x) < 2 ? [point.width] : [],
    ),
  )
  expect(interiorWidths.length).toBeGreaterThan(0)
  expect(Math.max(...interiorWidths)).toBeLessThan(0.4)

  // Same copper obstacles and connection, but with the board minimum raised
  // to 0.4mm: Pipeline9 can take the legal route around the lower obstacle.
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

  // Both panels are produced from real solver output, not hand-drawn routes.
  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "BUG: board min 0.10mm, center route 0.2375mm",
          pipeline: "end",
          graphics: convertSrjToGraphicsObject({ ...input, traces }),
        },
        {
          name: "CONTROL: board min 0.40mm, legal detour",
          pipeline: "end",
          graphics: convertSrjToGraphicsObject({
            ...controlInput,
            traces: controlTraces,
          }),
        },
      ],
      columns: 1,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
