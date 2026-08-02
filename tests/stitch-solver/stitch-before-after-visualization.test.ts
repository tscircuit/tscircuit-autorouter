import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import { createStitchSegmentRouter } from "lib/solvers/RouteStitchingSolver/create-stitch-segment-validator"
import type { Obstacle } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const makeRoute = ({
  startX,
  endX,
}: {
  startX: number
  endX: number
}): HighDensityIntraNodeRoute => ({
  connectionName: "candidate",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: startX, y: 0, z: 0 },
    { x: endX, y: 0, z: 0 },
  ],
  vias: [],
  jumpers: [],
})

const getStepGraphics = ({
  graphics,
  step,
}: {
  graphics: GraphicsObject
  step: number
}): GraphicsObject => ({
  ...graphics,
  points: graphics.points?.filter(
    (object) => object.step === undefined || object.step === step,
  ),
  lines: graphics.lines?.filter(
    (object) => object.step === undefined || object.step === step,
  ),
  infiniteLines: graphics.infiniteLines?.filter(
    (object) => object.step === undefined || object.step === step,
  ),
  rects: graphics.rects?.filter(
    (object) => object.step === undefined || object.step === step,
  ),
  polygons: graphics.polygons?.filter(
    (object) => object.step === undefined || object.step === step,
  ),
  circles: graphics.circles?.filter(
    (object) => object.step === undefined || object.step === step,
  ),
  texts: graphics.texts?.filter(
    (object) => object.step === undefined || object.step === step,
  ),
  arrows: graphics.arrows?.filter(
    (object) => object.step === undefined || object.step === step,
  ),
})

test("stitch visualization shows validated detours and explicit DRC handoff", async () => {
  const blockingObstacle: Obstacle = {
    obstacleId: "foreign-copper",
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.2,
    height: 0.2,
    layers: ["top"],
    connectedTo: ["foreign"],
  }
  const inputHdRoutes = [
    makeRoute({ startX: -1, endX: -0.35 }),
    makeRoute({ startX: 0.35, endX: 1 }),
  ]
  const stitchSegmentRouter = createStitchSegmentRouter({
    hdRoutes: inputHdRoutes,
    obstacles: [blockingObstacle],
    layerCount: 2,
    minClearance: 0.1,
  })
  const validatedSolver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "candidate",
    start: { x: -1, y: 0, z: 0 },
    end: { x: 1, y: 0, z: 0 },
    hdRoutes: inputHdRoutes,
    isValidStitchSegment: stitchSegmentRouter.isValidSegment,
    findValidStitchPath: stitchSegmentRouter.findValidPath,
    obstacles: [blockingObstacle],
    colorMap: { candidate: "#2563eb" },
  })

  validatedSolver.solve()

  expect(validatedSolver.failed).toBe(false)
  expect(validatedSolver.mergedHdRoute.route.length).toBeGreaterThan(4)
  const validatedVisualization = validatedSolver.visualize()
  expect(
    validatedVisualization.lines?.some(
      (line) => line.step === 2 && line.label === "Validated stitch segment",
    ),
  ).toBe(true)
  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "Before: disconnected fragments",
          step: 1,
          graphics: getStepGraphics({
            graphics: validatedVisualization,
            step: 1,
          }),
        },
        {
          name: "After: validated obstacle detour",
          step: 2,
          graphics: getStepGraphics({
            graphics: validatedVisualization,
            step: 2,
          }),
        },
      ],
      columns: 2,
      cellHeight: 1.2,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "validated-detour-before-after",
  })

  const repairObstacle: Obstacle = {
    obstacleId: "unavoidable-repair-area",
    type: "rect",
    center: { x: 1.25, y: 0 },
    width: 0.3,
    height: 0.5,
    layers: ["top"],
    connectedTo: ["foreign"],
  }
  const repairSolver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "candidate",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 2.5, y: 0, z: 0 },
    hdRoutes: [
      makeRoute({ startX: 0, endX: 1 }),
      makeRoute({ startX: 1.5, endX: 2.5 }),
    ],
    isValidStitchSegment: ({ start, end }) => Math.abs(start.x - end.x) < 0.5,
    stitchRepairPolicy: "allow_drc_repair",
    obstacles: [repairObstacle],
    colorMap: { candidate: "#2563eb" },
  })

  repairSolver.solve()

  expect(repairSolver.failed).toBe(false)
  const repairVisualization = repairSolver.visualize()
  expect(
    repairVisualization.lines?.some(
      (line) =>
        line.step === 3 && line.label === "Requires downstream DRC repair",
    ),
  ).toBe(true)
  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "Before: disconnected fragments",
          step: 1,
          graphics: getStepGraphics({
            graphics: repairVisualization,
            step: 1,
          }),
        },
        {
          name: "After: provisional topology bridge",
          step: 2,
          graphics: getStepGraphics({
            graphics: repairVisualization,
            step: 2,
          }),
        },
        {
          name: "Handoff: segment requiring repair",
          step: 3,
          graphics: getStepGraphics({
            graphics: repairVisualization,
            step: 3,
          }),
        },
      ],
      columns: 3,
      cellHeight: 1.2,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "repair-handoff-before-after",
  })
})
