import { pointToBoxDistance } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import type { Pipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { Obstacle } from "lib/types"

export function getBootViaCandidateGraphics({
  geometry,
  pads,
  accepted,
  clearance,
}: {
  geometry: Pipeline9RouteCopperGeometry
  pads: Obstacle[]
  accepted: boolean
  clearance: number
}): GraphicsObject {
  const signalPad = pads.find(
    (pad) => pad.circuitJsonMetadata?.source_port_name === "pin1",
  )!
  const via = geometry.viaSpans[0]!
  const gap = pointToBoxDistance(via.center, signalPad) - via.diameter / 2
  return {
    rects: [
      {
        center: signalPad.center,
        width: signalPad.width + clearance * 2,
        height: signalPad.height + clearance * 2,
        fill: "rgba(255,0,0,0.05)",
        stroke: "rgba(255,0,0,0.25)",
      },
      ...pads.map((pad) => ({
        center: pad.center,
        width: pad.width,
        height: pad.height,
        fill: "rgba(255,0,0,0.3)",
        stroke: "red",
        label: pad.circuitJsonMetadata?.source_port_name,
      })),
    ],
    lines: geometry.wireSegments.map((segment) => ({
      points: [segment.start, segment.end],
      strokeWidth: segment.width,
      strokeColor: segment.z === 0 ? "red" : "blue",
      strokeDash: segment.z === 0 ? undefined : [0.04, 0.04],
      layer: `z${segment.z}`,
    })),
    circles: geometry.viaSpans.map((span) => ({
      center: span.center,
      radius: span.diameter / 2,
      fill: "rgba(0,0,255,0.3)",
      stroke: "blue",
      layer: `z${Array.from(
        { length: span.maxZ - span.minZ + 1 },
        (_, index) => span.minZ + index,
      ).join(",")}`,
    })),
    texts: [
      {
        x: -2.2,
        y: 42.02,
        text: "R_BOOT_SEL1 / 3.3k / 0402",
        fontSize: 0.12,
        anchorSide: "center",
        color: "black",
      },
      ...pads.map((pad) => ({
        x: pad.center.x + pad.width / 2 + 0.05,
        y: pad.center.y,
        text:
          pad.circuitJsonMetadata?.source_port_name === "pin1"
            ? "1 → U_SOC.PC5"
            : "2 → GND",
        fontSize: 0.1,
        anchorSide: "center_left" as const,
        color: "black",
      })),
      {
        x: -2.2,
        y: 40.16,
        text: `PC5 pad gap: ${gap.toFixed(3)}mm (min ${clearance.toFixed(2)})`,
        fontSize: 0.11,
        anchorSide: "center",
        color: gap < clearance ? "red" : "green",
      },
      {
        x: -2.2,
        y: 39.96,
        text: `Native candidate validator: ${accepted ? "ACCEPT" : "REJECT"}`,
        fontSize: 0.11,
        anchorSide: "center",
        color: accepted ? "green" : "red",
      },
    ],
  }
}
