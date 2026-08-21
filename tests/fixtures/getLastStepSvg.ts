import { getSvgFromGraphicsObject } from "graphics-debug";
import type { GraphicsObject } from "graphics-debug";
import { getLastStepGraphicsObject } from "./getLastStepGraphicsObject";

export function getLastStepSvg(graphicsObject: GraphicsObject) {
  return getSvgFromGraphicsObject(getLastStepGraphicsObject(graphicsObject), {
    backgroundColor: "white",
  });
}
