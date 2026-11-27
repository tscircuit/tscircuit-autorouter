import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  createSrj16Sample37NodeSolver,
  getViaToPadCopperGap,
  SRJ16_SAMPLE37_PAD_CENTER,
  SRJ16_SAMPLE37_PAD_ID,
  SRJ16_SAMPLE37_PAD_SIZE,
  SRJ16_SAMPLE37_REQUIRED_VIA_TO_PAD_CLEARANCE,
} from "../fixtures/loadSrj16Sample37HdNodeInput"

const CROP_HALF_SIZE = 0.75

function findViolatingVias(
  routes: HighDensityRoute[],
): { x: number; y: number; viaDiameter: number; gap: number }[] {
  return routes
    .flatMap((route) =>
      route.vias.map((via) => ({
        x: via.x,
        y: via.y,
        viaDiameter: route.viaDiameter,
        gap: getViaToPadCopperGap({
          x: via.x,
          y: via.y,
          viaDiameter: route.viaDiameter,
        }),
      })),
    )
    .filter((via) => via.gap < SRJ16_SAMPLE37_REQUIRED_VIA_TO_PAD_CLEARANCE)
}

function cropToPad(graphics: GraphicsObject): GraphicsObject {
  return {
    lines: (graphics.lines ?? []).filter((line) =>
      line.points.some(
        (point) =>
          Math.abs(point.x - SRJ16_SAMPLE37_PAD_CENTER.x) <= CROP_HALF_SIZE &&
          Math.abs(point.y - SRJ16_SAMPLE37_PAD_CENTER.y) <= CROP_HALF_SIZE,
      ),
    ),
    rects: (graphics.rects ?? []).filter(
      (rect) =>
        Math.abs(rect.center.x - SRJ16_SAMPLE37_PAD_CENTER.x) <=
          CROP_HALF_SIZE &&
        Math.abs(rect.center.y - SRJ16_SAMPLE37_PAD_CENTER.y) <= CROP_HALF_SIZE,
    ),
    circles: (graphics.circles ?? []).filter(
      (circle) =>
        Math.abs(circle.center.x - SRJ16_SAMPLE37_PAD_CENTER.x) <=
          CROP_HALF_SIZE &&
        Math.abs(circle.center.y - SRJ16_SAMPLE37_PAD_CENTER.y) <=
          CROP_HALF_SIZE,
    ),
    points: (graphics.points ?? []).filter(
      (point) =>
        Math.abs(point.x - SRJ16_SAMPLE37_PAD_CENTER.x) <= CROP_HALF_SIZE &&
        Math.abs(point.y - SRJ16_SAMPLE37_PAD_CENTER.y) <= CROP_HALF_SIZE,
    ),
    texts: (graphics.texts ?? []).filter(
      (text) =>
        Math.abs(text.x - SRJ16_SAMPLE37_PAD_CENTER.x) <= CROP_HALF_SIZE &&
        Math.abs(text.y - SRJ16_SAMPLE37_PAD_CENTER.y) <= CROP_HALF_SIZE,
    ),
  }
}

test("srj16 sample 37 high density node via pad clearance snapshot", (): void => {
  const solver = createSrj16Sample37NodeSolver()
  solver.solve()
  const violations = findViolatingVias(solver.solvedRoutes)
  const cropped = cropToPad(solver.visualize())
  const graphics: GraphicsObject = {
    ...cropped,
    rects: [
      ...(cropped.rects ?? []),
      {
        center: SRJ16_SAMPLE37_PAD_CENTER,
        width: SRJ16_SAMPLE37_PAD_SIZE,
        height: SRJ16_SAMPLE37_PAD_SIZE,
        stroke: "#dc2626",
        fill: "rgba(220,38,38,0.15)",
        label: SRJ16_SAMPLE37_PAD_ID,
      },
      ...violations.map((via) => ({
        center: { x: via.x, y: via.y },
        width: via.viaDiameter,
        height: via.viaDiameter,
        stroke: "#dc2626",
        fill: "none",
        label: `via gap ${via.gap.toFixed(3)}mm`,
      })),
    ],
    texts: [
      ...(cropped.texts ?? []),
      {
        x: SRJ16_SAMPLE37_PAD_CENTER.x,
        y: SRJ16_SAMPLE37_PAD_CENTER.y + CROP_HALF_SIZE + 0.08,
        text: "Red: foreign BGA pad. The magenta via overlaps it by 0.084 mm",
        color: "#dc2626",
        anchorSide: "center",
        fontSize: 0.06,
      },
    ],
  }
  expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
