import type { GraphicsObject } from "graphics-debug"
import type { Pad } from "./parsePadJunctionInput"
import type { PadJunctionContext, PadVSearchResult } from "./padJunctionTypes"
import { visualizePadJunctionSimplification } from "./visualizePadJunctionSimplification"

export function visualizePadV(
  context: PadJunctionContext,
  pad: Pad | undefined,
  current: PadVSearchResult | undefined,
): GraphicsObject {
  const graphics = visualizePadJunctionSimplification(
    context.input,
    context.input.hdRoutes,
    context.pads,
    pad,
  )
  graphics.title = "Find V: terminal runs"
  if (!current) return graphics
  if ("outcome" in current.result) {
    graphics.title = current.result.reason
    return graphics
  }
  const v = current.result
  for (const run of v.runs) {
    graphics.lines!.push({
      points: [run.start, run.terminal],
      strokeColor: "#d97706",
      strokeWidth: v.width,
      label: "Run",
      layer: `z${run.terminal.z}`,
    })
  }
  return graphics
}
