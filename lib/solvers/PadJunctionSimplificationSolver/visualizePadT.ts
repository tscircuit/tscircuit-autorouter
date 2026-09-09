import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type {
  PadJunctionContext,
  PadTConstructionResult,
} from "./padJunctionTypes"
import { visualizePadJunctionSimplification } from "./visualizePadJunctionSimplification"

export function visualizePadT(
  context: PadJunctionContext,
  routes: ReadonlyArray<HighDensityRoute>,
  current: PadTConstructionResult | undefined,
  status: string,
): GraphicsObject {
  const graphics = visualizePadJunctionSimplification(
    context.input,
    routes,
    context.pads,
    current?.pad,
  )
  graphics.title = status
  if (!current) return graphics
  if ("outcome" in current.result) {
    graphics.title = current.result.reason
    return graphics
  }
  const { replacement, v } = current.result
  const layer = `z${replacement.junction.z}`
  graphics.lines!.push(
    {
      points: replacement.head,
      strokeColor: "#d97706",
      strokeWidth: v.width,
      label: "Head",
      layer,
    },
    {
      points: replacement.stem,
      strokeColor: "#d97706",
      strokeWidth: v.width,
      label: "Stem",
      layer,
    },
  )
  graphics.points = [
    { ...replacement.head[0], label: "Cut", color: "#d97706", layer },
    { ...replacement.head[1], label: "Cut", color: "#d97706", layer },
    { ...replacement.junction, label: "Junction", color: "#d97706", layer },
  ]
  return graphics
}
