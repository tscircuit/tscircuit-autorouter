import type { GraphicsObject, Line } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getGraphicsLayerForObstacle } from "lib/utils/getGraphicsObjectLayer"
import type {
  Pad,
  PadJunctionSimplificationInput,
} from "./parsePadJunctionInput"

export function visualizePadJunctionSimplification(
  input: PadJunctionSimplificationInput,
  hdRoutes: ReadonlyArray<HighDensityRoute>,
  pads: ReadonlyArray<Pad>,
  activePad?: Pad,
): GraphicsObject {
  const lines: Line[] = []
  const circles: NonNullable<GraphicsObject["circles"]> = []
  const viaLayer = `z${Array.from({ length: input.layerCount }, (_, z) => z).join(",")}`
  for (const route of [...hdRoutes, ...(input.otherHdRoutes ?? [])]) {
    for (const via of route.vias)
      circles.push({
        center: via,
        radius: route.viaDiameter / 2,
        fill: "rgba(0,0,255,0.4)",
        layer: viaLayer,
      })
    for (let index = 1; index < route.route.length; index++) {
      const start = route.route[index - 1]!
      const end = route.route[index]!
      if (start.z !== end.z) continue
      lines.push({
        points: [start, end],
        strokeWidth: start.traceThickness ?? route.traceThickness,
        strokeColor: input.colorMap?.[route.connectionName] ?? "red",
        strokeDash: start.z === 0 ? undefined : [0.08, 0.08],
        layer: `z${start.z}`,
        label: route.connectionName,
      })
    }
  }
  if (activePad) {
    const margin = Math.max(activePad.width, activePad.height) * 0.2
    const left = activePad.center.x - activePad.width / 2 - margin
    const right = activePad.center.x + activePad.width / 2 + margin
    const bottom = activePad.center.y - activePad.height / 2 - margin
    const top = activePad.center.y + activePad.height / 2 + margin
    lines.push({
      points: [
        { x: left, y: bottom },
        { x: right, y: bottom },
        { x: right, y: top },
        { x: left, y: top },
        { x: left, y: bottom },
      ],
      strokeColor: "#d97706",
      strokeWidth: 0.05,
      label: "Current pad",
      layer: getGraphicsLayerForObstacle(activePad, input.layerCount),
    })
  }
  return {
    title: "V pad junction simplification",
    coordinateSystem: "cartesian",
    lines,
    circles,
    rects: pads.map((pad) => ({
      center: pad.center,
      width: pad.width,
      height: pad.height,
      fill: "rgba(255,0,0,0.15)",
      layer: getGraphicsLayerForObstacle(pad, input.layerCount),
    })),
  }
}
