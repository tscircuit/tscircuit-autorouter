import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { getIcePiSixLayerFanoutRepro } from "../fixtures/icepi-six-layer-fanout"

const FANOUT_VIEW = { minX: 16.2, maxX: 17, minY: 4.75, maxY: 5.55 }

const isInFanoutView = (point: { x: number; y: number }) =>
  point.x >= FANOUT_VIEW.minX &&
  point.x <= FANOUT_VIEW.maxX &&
  point.y >= FANOUT_VIEW.minY &&
  point.y <= FANOUT_VIEW.maxY

const getFanoutVisualization = (graphics: GraphicsObject): GraphicsObject => ({
  coordinateSystem: graphics.coordinateSystem,
  title: graphics.title,
  circles: graphics.circles?.filter((circle) => isInFanoutView(circle.center)),
  points: graphics.points?.filter(isInFanoutView),
  lines: graphics.lines?.filter((line) => line.points.some(isInFanoutView)),
  rects: [
    ...(graphics.rects?.filter(
      (rect) =>
        rect.center.x + rect.width / 2 >= FANOUT_VIEW.minX &&
        rect.center.x - rect.width / 2 <= FANOUT_VIEW.maxX &&
        rect.center.y + rect.height / 2 >= FANOUT_VIEW.minY &&
        rect.center.y - rect.height / 2 <= FANOUT_VIEW.maxY,
    ) ?? []),
    {
      center: {
        x: (FANOUT_VIEW.minX + FANOUT_VIEW.maxX) / 2,
        y: (FANOUT_VIEW.minY + FANOUT_VIEW.maxY) / 2,
      },
      width: FANOUT_VIEW.maxX - FANOUT_VIEW.minX,
      height: FANOUT_VIEW.maxY - FANOUT_VIEW.minY,
      stroke: "transparent",
    },
  ],
})

test("IcePi fanout pair skips congested-port repair above 180 routes", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    getIcePiSixLayerFanoutRepro(),
    { effort: 0.01, cacheProvider: null },
  )

  solver.solveUntilPhase("portPointPathingSolver")
  solver.step()
  solver.step()

  const pathingSolver = solver.portPointPathingSolver!
  expect(pathingSolver.stats).toMatchObject({
    duplicateCongestedPortFallbackToOriginal: true,
    duplicateCongestedPortError: "Skipped for 181 connections",
    duplicateCongestedPortSourceCount: 0,
    duplicateCongestedPortCount: 0,
  })
  expect(
    getSvgFromGraphicsObject(
      getFanoutVisualization(pathingSolver.visualize()),
      { backgroundColor: "white", svgWidth: 700, svgHeight: 700 },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
