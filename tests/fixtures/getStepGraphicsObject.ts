import type { GraphicsObject } from "graphics-debug"

export const getStepGraphicsObject = ({
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
