import {
  getSegmentIntersection,
  isPointInsidePolygon,
  pointToSegmentClosestPoint,
} from "@tscircuit/math-utils"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type Point = { x: number; y: number }
type PadCopper = {
  id: string
  layers: string[]
} & (
  | { shape: "polygon"; points: Point[] }
  | { shape: "circle"; center: Point; radius: number }
)
type CopperWitness = { point: Point; distance: number }
export type Pipeline9PadCopperForceTarget = {
  center: Point
  segmentIndex: number
  obstacles: Obstacle[]
}

const getPadCopper = (element: Record<string, unknown>): PadCopper => {
  // Match the physical pad shapes emitted by convertToCircuitJson, before
  // the force context approximates rotated or circular copper as rectangles.
  const id =
    element.type === "pcb_smtpad"
      ? element.pcb_smtpad_id
      : element.pcb_plated_hole_id
  const layers =
    element.type === "pcb_smtpad" ? [element.layer] : element.layers
  if (
    typeof id !== "string" ||
    !Array.isArray(layers) ||
    layers.length === 0 ||
    !layers.every((layer): layer is string => typeof layer === "string") ||
    typeof element.x !== "number" ||
    typeof element.y !== "number" ||
    !Number.isFinite(element.x) ||
    !Number.isFinite(element.y)
  ) {
    throw new Error(
      "Pipeline9 pad force target requires physical pad geometry",
    )
  }
  const center = { x: element.x, y: element.y }
  if (element.type === "pcb_plated_hole" && element.shape === "circle") {
    const diameter = element.outer_diameter
    if (
      typeof diameter !== "number" ||
      !Number.isFinite(diameter) ||
      diameter <= 0
    ) {
      throw new Error(`Pipeline9 pad "${id}" has invalid circular copper`)
    }
    return { id, layers, shape: "circle", center, radius: diameter / 2 }
  }
  const isSmtRect =
    element.type === "pcb_smtpad" &&
    (element.shape === "rect" || element.shape === "rotated_rect")
  const isPlatedRect =
    element.type === "pcb_plated_hole" &&
    (element.shape === "circular_hole_with_rect_pad" ||
      element.shape === "rotated_pill_hole_with_rect_pad")
  const width = isSmtRect ? element.width : element.rect_pad_width
  const height = isSmtRect ? element.height : element.rect_pad_height
  const rotation = isSmtRect
    ? element.shape === "rotated_rect"
      ? element.ccw_rotation
      : 0
    : element.shape === "rotated_pill_hole_with_rect_pad"
      ? (element.rect_ccw_rotation ?? 0)
      : 0
  if (
    (!isSmtRect && !isPlatedRect) ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    typeof rotation !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(rotation) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`Pipeline9 pad "${id}" has unsupported physical copper`)
  }
  const angle = (rotation * Math.PI) / 180
  const points = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ].map((point): Point => ({
    x: center.x + point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: center.y + point.x * Math.sin(angle) + point.y * Math.cos(angle),
  }))
  return { id, layers, shape: "polygon", points }
}

const getSegmentCopperWitness = (
  start: Point,
  end: Point,
  copper: PadCopper,
): CopperWitness => {
  if (copper.shape === "circle") {
    const closest = pointToSegmentClosestPoint(copper.center, start, end)
    const dx = closest.x - copper.center.x
    const dy = closest.y - copper.center.y
    const distance = Math.hypot(dx, dy)
    if (distance <= copper.radius) return { point: closest, distance: 0 }
    return {
      point: {
        x: copper.center.x + (dx * copper.radius) / distance,
        y: copper.center.y + (dy * copper.radius) / distance,
      },
      distance: distance - copper.radius,
    }
  }
  if (isPointInsidePolygon(start, copper.points)) {
    return { point: { ...start }, distance: 0 }
  }
  if (isPointInsidePolygon(end, copper.points)) {
    return { point: { ...end }, distance: 0 }
  }
  let best: CopperWitness | undefined
  // This is the same segment/polygon endpoint-projection construction used by
  // the official checkPadTraceClearance, retaining its PAD-side witness.
  for (const [index, edgeStart] of copper.points.entries()) {
    const edgeEnd = copper.points[(index + 1) % copper.points.length]!
    const intersection = getSegmentIntersection(start, end, edgeStart, edgeEnd)
    if (intersection) return { point: intersection, distance: 0 }
    const candidates = [
      {
        trace: start,
        pad: pointToSegmentClosestPoint(start, edgeStart, edgeEnd),
      },
      { trace: end, pad: pointToSegmentClosestPoint(end, edgeStart, edgeEnd) },
      {
        trace: pointToSegmentClosestPoint(edgeStart, start, end),
        pad: edgeStart,
      },
      { trace: pointToSegmentClosestPoint(edgeEnd, start, end), pad: edgeEnd },
    ]
    for (const candidate of candidates) {
      const distance = Math.hypot(
        candidate.trace.x - candidate.pad.x,
        candidate.trace.y - candidate.pad.y,
      )
      if (best === undefined || distance < best.distance) {
        best = { point: { ...candidate.pad }, distance }
      }
    }
  }
  if (best === undefined) throw new Error("Pipeline9 pad polygon has no edges")
  return best
}

/** Select physical pad copper, not the fragment midpoint or pad center. */
export const getPipeline9PadCopperForceTarget = ({
  pad,
  route,
  obstacles,
  layerCount,
}: {
  pad: Record<string, unknown>
  route: HighDensityRoute
  obstacles: Obstacle[]
  layerCount: number
}): Pipeline9PadCopperForceTarget | undefined => {
  const copper = getPadCopper(pad)
  const targetObstacles = obstacles.filter((obstacle) =>
    obstacle.connectedTo.includes(copper.id),
  )
  if (targetObstacles.length === 0) {
    throw new Error(
      `Pipeline9 force pad "${copper.id}" has no physical projection`,
    )
  }
  let best: { target: Pipeline9PadCopperForceTarget; gap: number } | undefined
  for (let index = 0; index < route.route.length - 1; index++) {
    const start = route.route[index]!
    const end = route.route[index + 1]!
    if (
      start.z !== end.z ||
      (start.x === end.x && start.y === end.y) ||
      start.toNextSegmentType === "through_obstacle" ||
      !copper.layers.includes(mapZToLayerName(start.z, layerCount))
    ) {
      continue
    }
    const witness = getSegmentCopperWitness(start, end, copper)
    const gap =
      witness.distance - (start.traceThickness ?? route.traceThickness) / 2
    if (best === undefined || gap < best.gap) {
      best = {
        gap,
        target: {
          center: witness.point,
          segmentIndex: index,
          // A pad-side witness is on this copper, never outside Repair03's
          // near-obstacle lookup radius. Other pads cannot steal its identity;
          // they remain in the complete official candidate checks.
          obstacles: targetObstacles,
        },
      }
    }
  }
  return best?.target
}
