import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { combinePreloadedAndRoutedTraces } from "lib/utils/combinePreloadedAndRoutedTraces"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { createSrj23Sample57JointDrcRepairHarness } from "tests/fixtures/loadSrj23Sample57JointDrcRepairFixture"

const VIOLATION_CENTER = { x: -12.837150025762075, y: -3.985488865313009 }
const VIOLATION_VIA = { x: -12.793, y: -4.172 }
const VIOLATION_COLOR = "#c026d3"
const OFFENDING_SEGMENT = {
  start: { x: -12.773833706097431, y: -3.8717674901492174 },
  end: { x: -12.858265104052254, y: -3.8962885275345163 },
}

function buildViolationGraphics(): GraphicsObject {
  const { jointRepairParams, convertNewRoutes, createSolver } =
    createSrj23Sample57JointDrcRepairHarness()
  const solver = createSolver()
  solver.solve()

  const routedTraces = [
    ...convertNewRoutes(solver.getOutput()),
    ...solver.getUpdatedPreloadedTraces(),
  ]
  const graphics: GraphicsObject = convertSrjToGraphicsObject({
    ...jointRepairParams.srjWithPointPairs,
    traces: combinePreloadedAndRoutedTraces(
      jointRepairParams.originalSrj.traces ?? [],
      routedTraces,
    ),
  })
  graphics.points = []
  graphics.lines = [
    ...(graphics.lines ?? []),
    {
      points: [OFFENDING_SEGMENT.start, OFFENDING_SEGMENT.end],
      strokeColor: VIOLATION_COLOR,
      strokeWidth: 0.14,
      label: "source_net_4_mst0_0",
    },
  ]
  graphics.circles = [
    ...(graphics.circles ?? []),
    {
      center: VIOLATION_VIA,
      radius: 0.2,
      fill: "rgba(192, 38, 211, 0.3)",
      stroke: VIOLATION_COLOR,
      label: "net 2 via, 0.083mm from net 4",
    },
  ]
  graphics.rects = [
    ...(graphics.rects ?? []),
    {
      center: VIOLATION_CENTER,
      width: 1.6,
      height: 1.1,
      fill: "rgba(0, 0, 0, 0)",
      stroke: "rgb(220, 38, 38)",
      label: "srj23 sample 57 joint repair output",
    },
  ]
  graphics.texts = [
    {
      x: -14.55,
      y: -2.12,
      text: "Magenta: net 2 via 0.083 mm from net 4 trace (0.1 mm required)",
      fontSize: 0.075,
      color: VIOLATION_COLOR,
      anchorSide: "bottom_left",
    },
  ]
  return graphics
}

test("srj23 sample 57 joint repair output shows the net 4 clearance violation", (): void => {
  const graphics = buildViolationGraphics()
  const focused: GraphicsObject = {
    ...graphics,
    lines: (graphics.lines ?? []).filter((line) =>
      line.points.every(
        (point) => Math.hypot(point.x + 12.8, point.y + 4) < 1.8,
      ),
    ),
    circles: (graphics.circles ?? []).filter(
      (circle) => Math.hypot(circle.center.x + 12.8, circle.center.y + 4) < 1.8,
    ),
    rects: (graphics.rects ?? []).filter(
      (rect) => Math.hypot(rect.center.x + 12.8, rect.center.y + 4) < 1.8,
    ),
    points: (graphics.points ?? []).filter(
      (point) => Math.hypot(point.x + 12.8, point.y + 4) < 1.8,
    ),
  }
  expect(
    getSvgFromGraphicsObject(focused, {
      backgroundColor: "white",
      svgWidth: 1000,
      svgHeight: 1000,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
