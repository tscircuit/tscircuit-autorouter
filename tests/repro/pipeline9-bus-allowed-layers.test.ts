import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

test("Pipeline9 routes a top-only bus on the bottom layer despite a legal top detour", async (): Promise<void> => {
  const input: SimpleRouteJson = {
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.45,
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -8, y: 0 },
        width: 0.8,
        height: 0.8,
        connectedTo: ["CLOCK"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 8, y: 0 },
        width: 0.8,
        height: 0.8,
        connectedTo: ["CLOCK"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 10,
        height: 16,
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "CLOCK",
        pointsToConnect: [
          { x: -8, y: 0, layer: "top", pointId: "left" },
          { x: 8, y: 0, layer: "top", pointId: "right" },
        ],
      },
    ],
    buses: [
      {
        busId: "TOP_CLOCK",
        connectionNames: ["CLOCK"],
        allowedLayers: ["top"],
      },
    ],
  }

  const controlSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    { ...input, layerCount: 1 },
    { cacheProvider: null },
  )
  controlSolver.solve()
  expect(controlSolver.solved).toBe(true)
  expect(controlSolver.failed).toBe(false)
  expect(
    controlSolver
      .getOutputSimplifiedPcbTraces()
      .flatMap((trace) => trace.route)
      .every((point) => point.route_type === "wire" && point.layer === "top"),
  ).toBe(true)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const route = solver
    .getOutputSimplifiedPcbTraces()
    .flatMap((trace) => trace.route)
  expect(
    route.some(
      (point) =>
        point.route_type === "via" ||
        (point.route_type === "wire" && point.layer === "bottom"),
    ),
  ).toBe(true)

  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "BUG: two-layer board, bus allowed on top only",
          pipeline: "end",
          graphics: convertSrjToGraphicsObject({
            ...input,
            traces: solver.getOutputSimplifiedPcbTraces(),
          }),
        },
        {
          name: "CONTROL: same copper routes on top-only board",
          pipeline: "end",
          graphics: convertSrjToGraphicsObject({
            ...input,
            layerCount: 1,
            traces: controlSolver.getOutputSimplifiedPcbTraces(),
          }),
        },
      ],
      columns: 1,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
