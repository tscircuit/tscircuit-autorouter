// Pinned from @tscircuit/checks 0.0.233 bundled source; see the authoritative-drc-fork LICENSE and PROVENANCE.md.
import {
  cju,
  distanceBetweenCircleAndCircle,
  distanceBetweenCircleAndPolygon,
  distanceBetweenPolygonAndPolygon,
  getBoundsOfPcbElements,
} from "@tscircuit/circuit-json-util"
import {
  midpoint,
  pointToSegmentClosestPoint,
  segmentToCircleMinDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import type {
  AnyCircuitElement,
  PCBKeepout,
  PcbPlatedHole,
  PcbSmtPad,
  PcbTrace,
  PcbVia,
} from "circuit-json"
import type { PcbTraceSegment } from "../check-each-pcb-trace-non-overlapping/getCollidableBounds"
import {
  getPillCenterLineForPad,
  getPolygonPointsForPad,
  getSegmentToPillClearance,
  getSegmentToPolygonClearanceFromPoints,
} from "../check-each-pcb-trace-non-overlapping/segment-to-polygon-clearance"
import type { Bounds } from "../data-structures/SpatialIndex"
import { DEFAULT_TRACE_THICKNESS } from "../drc-defaults"

export type PadElement = PcbSmtPad | PcbPlatedHole
export type PadClearanceElement = PadElement | PcbVia
export type CopperClearanceElement = PadClearanceElement | PCBKeepout

export const getPadBounds = (pad: CopperClearanceElement): Bounds => {
  if (pad.type === "pcb_keepout") {
    if (pad.shape === "outline") {
      return {
        minX: Math.min(...pad.outline.map((point) => point.x)),
        minY: Math.min(...pad.outline.map((point) => point.y)),
        maxX: Math.max(...pad.outline.map((point) => point.x)),
        maxY: Math.max(...pad.outline.map((point) => point.y)),
      }
    }

    if (pad.shape === "circle") {
      return {
        minX: pad.center.x - pad.radius,
        minY: pad.center.y - pad.radius,
        maxX: pad.center.x + pad.radius,
        maxY: pad.center.y + pad.radius,
      }
    }

    return {
      minX: pad.center.x - pad.width / 2,
      minY: pad.center.y - pad.height / 2,
      maxX: pad.center.x + pad.width / 2,
      maxY: pad.center.y + pad.height / 2,
    }
  }

  return getBoundsOfPcbElements([pad])
}

export const getPadCenter = (pad: CopperClearanceElement) => {
  if (pad.type === "pcb_keepout" && pad.shape !== "outline") return pad.center
  const bounds = getPadBounds(pad)
  return midpoint(
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
  )
}

export const getPadRadius = (pad: CopperClearanceElement) => {
  if (pad.type === "pcb_keepout" && pad.shape === "circle") return pad.radius
  const bounds = getPadBounds(pad)
  return Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2
}

export const isCircularPad = (pad: CopperClearanceElement) =>
  pad.type === "pcb_via" || pad.shape === "circle"

const isPillPad = (
  pad: CopperClearanceElement,
): pad is
  | Extract<PcbSmtPad, { shape: "pill" | "rotated_pill" }>
  | Extract<PcbPlatedHole, { shape: "oval" | "pill" }> =>
  (pad.type === "pcb_smtpad" &&
    (pad.shape === "pill" || pad.shape === "rotated_pill")) ||
  (pad.type === "pcb_plated_hole" &&
    (pad.shape === "oval" || pad.shape === "pill"))

const getCircleShape = (pad: CopperClearanceElement) => {
  const center = getPadCenter(pad)
  return {
    kind: "circle" as const,
    x: center.x,
    y: center.y,
    radius: getPadRadius(pad),
  }
}

const getPolygonShape = (pad: CopperClearanceElement) => {
  if (pad.type === "pcb_keepout") {
    if (pad.shape === "outline") {
      return {
        kind: "polygon" as const,
        points: pad.outline,
      }
    }

    if (pad.shape !== "rect") {
      throw new Error(`Expected rectangular keepout, got ${pad.shape}`)
    }

    return {
      kind: "polygon" as const,
      points: [
        {
          x: pad.center.x - pad.width / 2,
          y: pad.center.y - pad.height / 2,
        },
        {
          x: pad.center.x + pad.width / 2,
          y: pad.center.y - pad.height / 2,
        },
        {
          x: pad.center.x + pad.width / 2,
          y: pad.center.y + pad.height / 2,
        },
        {
          x: pad.center.x - pad.width / 2,
          y: pad.center.y + pad.height / 2,
        },
      ],
    }
  }

  if (
    pad.type === "pcb_smtpad" &&
    (pad.shape === "polygon" || pad.shape === "rotated_rect")
  ) {
    return {
      kind: "polygon" as const,
      points: getPolygonPointsForPad(pad),
    }
  }

  if (
    pad.type === "pcb_plated_hole" &&
    "rect_pad_width" in pad &&
    "rect_pad_height" in pad
  ) {
    return {
      kind: "polygon" as const,
      points: getPolygonPointsForPad(pad),
    }
  }

  const bounds = getPadBounds(pad)
  return {
    kind: "polygon" as const,
    points: [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ],
  }
}

// A rounded rectangle is an inset rectangle expanded by corner_radius.
// At the maximum radius its inset collapses, so use the existing pill geometry.
const getRoundedPadCore = (pad: CopperClearanceElement) => {
  if (
    pad.type !== "pcb_smtpad" ||
    (pad.shape !== "rect" && pad.shape !== "rotated_rect") ||
    !pad.corner_radius ||
    pad.corner_radius <= 0
  )
    return null

  const radius = Math.min(pad.corner_radius, pad.width / 2, pad.height / 2)
  if (radius === Math.min(pad.width, pad.height) / 2) {
    const core: PcbSmtPad = {
      ...pad,
      shape: "rotated_pill",
      radius,
      ccw_rotation: pad.shape === "rotated_rect" ? pad.ccw_rotation : 0,
    }
    return { core, radius: 0 }
  }
  return {
    core: {
      ...pad,
      width: pad.width - 2 * radius,
      height: pad.height - 2 * radius,
      corner_radius: 0,
    },
    radius,
  }
}

export const getPadToPadGap = (
  padA: CopperClearanceElement,
  padB: CopperClearanceElement,
): number => {
  const roundedA = getRoundedPadCore(padA)
  const roundedB = getRoundedPadCore(padB)
  if (roundedA || roundedB) {
    return (
      getPadToPadGap(roundedA?.core ?? padA, roundedB?.core ?? padB) -
      (roundedA?.radius ?? 0) -
      (roundedB?.radius ?? 0)
    )
  }
  if (isPillPad(padA) && isPillPad(padB)) {
    const pillA = getPillCenterLineForPad(padA)
    const pillB = getPillCenterLineForPad(padB)
    return (
      segmentToSegmentMinDistance(
        pillA.start,
        pillA.end,
        pillB.start,
        pillB.end,
      ) -
      pillA.radius -
      pillB.radius
    )
  }

  if (isPillPad(padA) && isCircularPad(padB)) {
    const pill = getPillCenterLineForPad(padA)
    return (
      segmentToCircleMinDistance(pill.start, pill.end, getCircleShape(padB)) -
      pill.radius
    )
  }

  if (isCircularPad(padA) && isPillPad(padB)) {
    const pill = getPillCenterLineForPad(padB)
    return (
      segmentToCircleMinDistance(pill.start, pill.end, getCircleShape(padA)) -
      pill.radius
    )
  }

  if (isPillPad(padA)) {
    const pill = getPillCenterLineForPad(padA)
    return (
      getSegmentToPolygonClearanceFromPoints(
        pill.start,
        pill.end,
        getPolygonShape(padB).points,
      ).distance - pill.radius
    )
  }

  if (isPillPad(padB)) {
    const pill = getPillCenterLineForPad(padB)
    return (
      getSegmentToPolygonClearanceFromPoints(
        pill.start,
        pill.end,
        getPolygonShape(padA).points,
      ).distance - pill.radius
    )
  }

  if (isCircularPad(padA) && isCircularPad(padB)) {
    return distanceBetweenCircleAndCircle(
      getCircleShape(padA),
      getCircleShape(padB),
    )
  }

  if (isCircularPad(padA)) {
    return distanceBetweenCircleAndPolygon(
      getCircleShape(padA),
      getPolygonShape(padB),
    )
  }

  if (isCircularPad(padB)) {
    return distanceBetweenCircleAndPolygon(
      getCircleShape(padB),
      getPolygonShape(padA),
    )
  }

  return distanceBetweenPolygonAndPolygon(
    getPolygonShape(padA),
    getPolygonShape(padB),
  )
}

export const getPads = (circuitJson: AnyCircuitElement[]) =>
  [
    ...cju(circuitJson).pcb_smtpad.list(),
    ...cju(circuitJson).pcb_plated_hole.list(),
  ] as PadElement[]

export const getTraceSegments = (
  circuitJson: AnyCircuitElement[],
): PcbTraceSegment[] => {
  const pcbTraces = cju(circuitJson).pcb_trace.list()

  return pcbTraces.flatMap((pcbTrace) => {
    const segments: PcbTraceSegment[] = []

    for (let i = 0; i < pcbTrace.route.length - 1; i++) {
      const p1 = pcbTrace.route[i]
      const p2 = pcbTrace.route[i + 1]
      if (p1.route_type !== "wire") continue
      if (p2.route_type !== "wire") continue
      if (p1.layer !== p2.layer) continue

      segments.push({
        type: "pcb_trace_segment",
        pcb_trace_id: pcbTrace.pcb_trace_id,
        _pcbTrace: pcbTrace as PcbTrace,
        thickness:
          "width" in p1
            ? p1.width
            : "width" in p2
              ? p2.width
              : DEFAULT_TRACE_THICKNESS!,
        layer: p1.layer,
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
      })
    }

    return segments
  })
}

export type TraceClearanceObstacle = PadElement | PcbVia

const getCenterBetweenCopperEdges = ({
  tracePoint,
  obstaclePoint,
  traceRadius,
  obstacleRadius,
}: {
  tracePoint: { x: number; y: number }
  obstaclePoint: { x: number; y: number }
  traceRadius: number
  obstacleRadius: number
}) => {
  const dx = obstaclePoint.x - tracePoint.x
  const dy = obstaclePoint.y - tracePoint.y
  const distance = Math.hypot(dx, dy)
  if (distance === 0) return midpoint(tracePoint, obstaclePoint)

  const unitX = dx / distance
  const unitY = dy / distance
  // For overlapping copper, choose a point in the shared interval. This also
  // handles one circle containing the other without placing the marker outside
  // the smaller shape. A polygon's nearest boundary has obstacleRadius=0.
  if (distance <= traceRadius + obstacleRadius) {
    const overlapStart = Math.max(-traceRadius, distance - obstacleRadius)
    const overlapEnd = Math.min(traceRadius, distance + obstacleRadius)
    const offset = (overlapStart + overlapEnd) / 2
    return {
      x: tracePoint.x + unitX * offset,
      y: tracePoint.y + unitY * offset,
    }
  }

  const traceEdge = {
    x: tracePoint.x + unitX * traceRadius,
    y: tracePoint.y + unitY * traceRadius,
  }
  const obstacleEdge = {
    x: obstaclePoint.x - unitX * obstacleRadius,
    y: obstaclePoint.y - unitY * obstacleRadius,
  }

  return midpoint(traceEdge, obstacleEdge)
}

export const getTraceObstacleClearance = (
  segment: Pick<PcbTraceSegment, "x1" | "y1" | "x2" | "y2" | "thickness">,
  obstacle: TraceClearanceObstacle,
): { gap: number; center: { x: number; y: number } } => {
  const rounded = getRoundedPadCore(obstacle)
  if (rounded) obstacle = rounded.core
  const obstacleRadius = rounded?.radius ?? 0
  const start = { x: segment.x1, y: segment.y1 }
  const end = { x: segment.x2, y: segment.y2 }
  const traceRadius = segment.thickness / 2

  if (obstacle.type === "pcb_via" || isCircularPad(obstacle)) {
    const circle =
      obstacle.type === "pcb_via"
        ? {
            x: obstacle.x,
            y: obstacle.y,
            radius: obstacle.outer_diameter / 2,
          }
        : getCircleShape(obstacle)
    const closestPoint = pointToSegmentClosestPoint(circle, start, end)

    return {
      gap: segmentToCircleMinDistance(start, end, circle) - traceRadius,
      center: getCenterBetweenCopperEdges({
        tracePoint: closestPoint,
        obstaclePoint: circle,
        traceRadius,
        obstacleRadius: circle.radius,
      }),
    }
  }

  if (isPillPad(obstacle)) {
    const clearance = getSegmentToPillClearance(segment, obstacle)
    return {
      gap: clearance.distance - traceRadius - clearance.radius,
      center: getCenterBetweenCopperEdges({
        tracePoint: clearance.tracePoint,
        obstaclePoint: clearance.obstaclePoint,
        traceRadius,
        obstacleRadius: clearance.radius,
      }),
    }
  }

  const clearance = getSegmentToPolygonClearanceFromPoints(
    start,
    end,
    getPolygonShape(obstacle).points,
  )
  return {
    gap: clearance.distance - traceRadius - obstacleRadius,
    center: getCenterBetweenCopperEdges({
      tracePoint: clearance.tracePoint,
      obstaclePoint: clearance.obstaclePoint,
      traceRadius,
      obstacleRadius,
    }),
  }
}

export const isTraceObstacleOverlap = (gap: number): boolean => gap <= 0

/** A via is a zero-length segment with the width of its outer copper.
 * Use the same nearest-copper geometry as trace clearance markers. */
export const getViaPadClearanceCenter = (via: PcbVia, pad: PadElement) =>
  getTraceObstacleClearance(
    {
      x1: via.x,
      y1: via.y,
      x2: via.x,
      y2: via.y,
      thickness: via.outer_diameter,
    },
    pad,
  ).center
