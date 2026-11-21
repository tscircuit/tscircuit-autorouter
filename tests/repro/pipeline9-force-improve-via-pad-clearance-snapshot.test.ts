import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import {
  createSrj19Sample76ForceImproveSolver,
  findSrj19Sample76ViaPadViolations,
  loadSrj19Sample76ForceImproveInput,
  SRJ19_SAMPLE76_PAD_CENTER,
  SRJ19_SAMPLE76_PAD_SIZE,
  SRJ19_SAMPLE76_VIA_DIAMETER,
} from "../fixtures/loadSrj19Sample76ForceImproveInput"

const CROP_HALF_SIZE = 0.75

const cropGraphics = (graphics: GraphicsObject): GraphicsObject => ({
  points: (graphics.points ?? []).filter(
    (point) =>
      Math.abs(point.x - SRJ19_SAMPLE76_PAD_CENTER.x) <= CROP_HALF_SIZE &&
      Math.abs(point.y - SRJ19_SAMPLE76_PAD_CENTER.y) <= CROP_HALF_SIZE,
  ),
  lines: (graphics.lines ?? []).filter((line) =>
    line.points.some(
      (point) =>
        Math.abs(point.x - SRJ19_SAMPLE76_PAD_CENTER.x) <= CROP_HALF_SIZE &&
        Math.abs(point.y - SRJ19_SAMPLE76_PAD_CENTER.y) <= CROP_HALF_SIZE,
    ),
  ),
  rects: (graphics.rects ?? []).filter(
    (rect) =>
      Math.abs(rect.center.x - SRJ19_SAMPLE76_PAD_CENTER.x) <= CROP_HALF_SIZE &&
      Math.abs(rect.center.y - SRJ19_SAMPLE76_PAD_CENTER.y) <= CROP_HALF_SIZE,
  ),
  circles: (graphics.circles ?? []).filter(
    (circle) =>
      Math.abs(circle.center.x - SRJ19_SAMPLE76_PAD_CENTER.x) <=
        CROP_HALF_SIZE &&
      Math.abs(circle.center.y - SRJ19_SAMPLE76_PAD_CENTER.y) <= CROP_HALF_SIZE,
  ),
  polygons: (graphics.polygons ?? []).filter((polygon) =>
    polygon.points.some(
      (point) =>
        Math.abs(point.x - SRJ19_SAMPLE76_PAD_CENTER.x) <= CROP_HALF_SIZE &&
        Math.abs(point.y - SRJ19_SAMPLE76_PAD_CENTER.y) <= CROP_HALF_SIZE,
    ),
  ),
  texts: (graphics.texts ?? []).filter(
    (text) =>
      Math.abs(text.x - SRJ19_SAMPLE76_PAD_CENTER.x) <= CROP_HALF_SIZE &&
      Math.abs(text.y - SRJ19_SAMPLE76_PAD_CENTER.y) <= CROP_HALF_SIZE,
  ),
})

test("Pipeline 9 force improvement via to BGA pad clearance snapshot", (): void => {
  const fixture = loadSrj19Sample76ForceImproveInput()
  const solver = createSrj19Sample76ForceImproveSolver(fixture)
  const violations = findSrj19Sample76ViaPadViolations(solver.getOutput())

  const cropped = cropGraphics(solver.visualize())
  const highlightRects = [
    {
      center: SRJ19_SAMPLE76_PAD_CENTER,
      width: SRJ19_SAMPLE76_PAD_SIZE,
      height: SRJ19_SAMPLE76_PAD_SIZE,
      stroke: "magenta",
      fill: "rgba(255,0,255,0.2)",
      label: "pcb_smtpad_116",
    },
    ...violations.map((violation) => ({
      center: { x: violation.x, y: violation.y },
      width: SRJ19_SAMPLE76_VIA_DIAMETER,
      height: SRJ19_SAMPLE76_VIA_DIAMETER,
      stroke: "magenta",
      fill: "rgba(255,0,255,0.45)",
      label: `via gap ${violation.gap.toFixed(3)}mm`,
    })),
  ]
  const graphics: GraphicsObject = {
    ...cropped,
    rects: [...(cropped.rects ?? []), ...highlightRects],
    texts: [
      ...(cropped.texts ?? []),
      {
        x: SRJ19_SAMPLE76_PAD_CENTER.x,
        y: SRJ19_SAMPLE76_PAD_CENTER.y + CROP_HALF_SIZE + 0.08,
        text: "Magenta: via moved within 0.1 mm of a foreign BGA pad",
        color: "magenta",
        anchorSide: "center",
        fontSize: 0.06,
      },
    ],
  }

  expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
