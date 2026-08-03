import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const getStepGraphics = (
  graphics: GraphicsObject,
  step: number,
): GraphicsObject => ({
  ...graphics,
  points: graphics.points?.filter((item) => item.step === step),
  lines: graphics.lines?.filter((item) => item.step === step),
  circles: graphics.circles?.filter((item) => item.step === step),
  rects: graphics.rects?.filter((item) => item.step === step),
})

test("cross-layer stitch creates an explicit vertical transition", async () => {
  const hdRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "cross_layer_connection",
      traceThickness: 0.0015,
      viaDiameter: 0.003,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 0.01, y: 0, z: 0 },
      ],
      vias: [],
      jumpers: [],
    },
    {
      connectionName: "cross_layer_connection",
      traceThickness: 0.0015,
      viaDiameter: 0.003,
      route: [
        { x: 0.0108, y: 0.0004, z: 1 },
        { x: 0.02, y: 0.0004, z: 1 },
      ],
      vias: [],
      jumpers: [],
    },
  ]
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "cross_layer_connection",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 0.02, y: 0.0004, z: 1 },
    hdRoutes,
    colorMap: { cross_layer_connection: "#2563eb" },
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.vias).toEqual([
    { x: 0.0108, y: 0.0004 },
  ])
  expect(
    solver.mergedHdRoute.route.some((point, index, route) => {
      const nextPoint = route[index + 1]
      return (
        nextPoint &&
        point.x === 0.0108 &&
        point.y === 0.0004 &&
        nextPoint.x === point.x &&
        nextPoint.y === point.y &&
        nextPoint.z !== point.z
      )
    }),
  ).toBe(true)

  const visualization = solver.visualize()
  expect(
    visualization.circles?.some(
      (circle) => circle.label === "Canonical stitch layer transition",
    ),
  ).toBe(true)
  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "Before: offset cross-layer fragments",
          step: 1,
          graphics: getStepGraphics(visualization, 1),
        },
        {
          name: "After: explicit vertical transition",
          step: 2,
          graphics: getStepGraphics(visualization, 2),
        },
      ],
      columns: 2,
      cellHeight: 0.012,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "cross-layer-transition-before-after",
  })
})
