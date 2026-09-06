import type { AnyCircuitElement } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

export type Pipeline9HighDensityForceContext = {
  connMap: ConnectivityMap
  obstacles: Obstacle[]
}

/** Projects the actual serialized pads into the force operator's rectangle domain. */
export const getPipeline9HighDensityForceObstacles = ({
  circuitJson,
  bounds,
  layerCount,
  minTraceWidth,
}: Pick<SimpleRouteJson, "bounds" | "layerCount" | "minTraceWidth"> & {
  circuitJson: AnyCircuitElement[]
}): Obstacle[] => {
  const obstacles: Obstacle[] = []
  for (const element of circuitJson) {
    if (element.type === "pcb_hole") {
      throw new Error(
        "Pipeline9 force projection requires supported pad geometry",
      )
    }
    if (element.type !== "pcb_smtpad" && element.type !== "pcb_plated_hole") {
      continue
    }
    // These are exactly the pad shapes emitted by convertToCircuitJson. Keep
    // the physical identity from that output, never routing aliases or a new ID.
    const pad = element as unknown as Record<string, unknown>
    const padId =
      element.type === "pcb_smtpad"
        ? element.pcb_smtpad_id
        : element.pcb_plated_hole_id
    let width: unknown
    let height: unknown
    let rotation: unknown
    let layers: unknown
    if (element.type === "pcb_smtpad") {
      if (pad.shape !== "rect" && pad.shape !== "rotated_rect") {
        throw new Error(`Pipeline9 cannot project SMT pad "${padId}"`)
      }
      width = pad.width
      height = pad.height
      rotation = pad.shape === "rotated_rect" ? pad.ccw_rotation : undefined
      layers = [pad.layer]
    } else {
      layers = pad.layers
      if (pad.shape === "circle") {
        // Retain the existing conservative rectangular force envelope. The
        // official evaluator continues checking the actual circular copper.
        width = pad.outer_diameter
        height = pad.outer_diameter
      } else if (
        pad.shape === "circular_hole_with_rect_pad" ||
        pad.shape === "rotated_pill_hole_with_rect_pad"
      ) {
        width = pad.rect_pad_width
        height = pad.rect_pad_height
        rotation =
          pad.shape === "rotated_pill_hole_with_rect_pad"
            ? pad.rect_ccw_rotation
            : undefined
      } else {
        throw new Error(`Pipeline9 cannot project plated pad "${padId}"`)
      }
    }
    if (
      typeof pad.x !== "number" ||
      typeof pad.y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number" ||
      !Number.isFinite(pad.x) ||
      !Number.isFinite(pad.y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      (rotation !== undefined &&
        (typeof rotation !== "number" || !Number.isFinite(rotation))) ||
      !Array.isArray(layers) ||
      layers.length === 0 ||
      !layers.every((layer): layer is string => typeof layer === "string")
    ) {
      throw new Error(
        `Pipeline9 serialized pad "${padId}" has invalid geometry`,
      )
    }
    const obstacle: Obstacle = {
      type: "rect",
      center: { x: pad.x, y: pad.y },
      width,
      height,
      layers,
      connectedTo: [padId],
      circuitJsonMetadata:
        element.type === "pcb_smtpad"
          ? { pcb_smtpad_id: padId }
          : { pcb_plated_hole_id: padId },
      ...(rotation === undefined ? {} : { ccwRotationDegrees: rotation }),
    }
    // Approximate each physical pad separately. The shared helper may merge
    // coincident rectangles, which must not combine distinct pad identities.
    obstacles.push(
      ...addApproximatingRectsToSrj({
        bounds,
        layerCount,
        minTraceWidth,
        connections: [],
        obstacles: [obstacle],
      }).obstacles,
    )
  }
  return obstacles
}
