import { getBoundsOfPcbElements, getReadableNameForElement } from "@tscircuit/circuit-json-util"
import {
  getSegmentIntersection,
  isPointInsidePolygon,
  pointToSegmentClosestPoint,
  segmentToCircleMinDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import RBush from "rbush"

type Point = { x: number; y: number }
type PadOrVia = Extract<
  AnyCircuitElement,
  { type: "pcb_smtpad" | "pcb_plated_hole" | "pcb_via" }
>
type IndexedObstacle = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  id: string
  order: number
  layers: string[]
  element: PadOrVia
  clearanceBounds: { minX: number; minY: number; maxX: number; maxY: number }
  shape: { kind: "circle"; center: Point; radius: number } | {
    kind: "polygon"
    points: Point[]
  }
}
type Clearance = { gap: number; center: Point }
type TraceSegment = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  order: number
  trace: PcbTrace
  traceOrder: number
  start: Point
  end: Point
  layer: string
  width: number
  portIds: string[]
}
type DrcError = Record<string, unknown>
type ObstacleClearanceEvaluator = (
  circuitJson: AnyCircuitElement[],
  connMap: ConnectivityMap,
) => DrcError[]

const TRACE_CLEARANCE = 0.1
const DRC_EPSILON = 5e-3

const compileObstacle = (
  element: PadOrVia,
  order: number,
): IndexedObstacle => {
  const id = element.type === "pcb_via"
    ? element.pcb_via_id
    : element.type === "pcb_smtpad"
      ? element.pcb_smtpad_id
      : element.pcb_plated_hole_id
  const layers = element.type === "pcb_smtpad"
    ? [element.layer]
    : element.layers
  const clearanceBounds = getBoundsOfPcbElements([element])
  if (element.type === "pcb_via" || element.shape === "circle") {
    const radius = element.type === "pcb_via"
      ? element.outer_diameter / 2
      : element.type === "pcb_smtpad" && element.shape === "circle"
        ? element.radius
        : (element as Extract<PadOrVia, { type: "pcb_plated_hole" }> & {
            outer_diameter: number
          }).outer_diameter / 2
    return {
      id, order, layers, element, clearanceBounds,
      minX: element.x - radius,
      minY: element.y - radius,
      maxX: element.x + radius,
      maxY: element.y + radius,
      shape: { kind: "circle", center: { x: element.x, y: element.y }, radius },
    }
  }
  let width: number
  let height: number
  let rotation: number
  if (element.type === "pcb_smtpad" &&
      (element.shape === "rect" || element.shape === "rotated_rect")) {
    width = element.width
    height = element.height
    rotation = element.shape === "rotated_rect" ? element.ccw_rotation : 0
  } else if (element.type === "pcb_plated_hole" &&
      "rect_pad_width" in element && "rect_pad_height" in element) {
    width = element.rect_pad_width
    height = element.rect_pad_height
    rotation = "rect_ccw_rotation" in element && typeof element.rect_ccw_rotation === "number"
      ? element.rect_ccw_rotation
      : 0
  } else {
    throw new Error(`Unsupported autorouting DRC obstacle shape: ${element.type} ${element.shape}`)
  }
  const angle = rotation * Math.PI / 180
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const points = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ].map((point) => ({
    x: element.x + (point.x * cosine - point.y * sine),
    y: element.y + (point.x * sine + point.y * cosine),
  }))
  return {
    id, order, layers, element, clearanceBounds,
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
    shape: { kind: "polygon", points },
  }
}

const getClosestPointsBetweenSegments = (
  start: Point,
  end: Point,
  edgeStart: Point,
  edgeEnd: Point,
): { distance: number; tracePoint: Point; obstaclePoint: Point } => {
  const intersection = getSegmentIntersection(start, end, edgeStart, edgeEnd)
  if (intersection) {
    return { distance: 0, tracePoint: intersection, obstaclePoint: intersection }
  }
  const candidates = [
    { tracePoint: start, obstaclePoint: pointToSegmentClosestPoint(start, edgeStart, edgeEnd) },
    { tracePoint: end, obstaclePoint: pointToSegmentClosestPoint(end, edgeStart, edgeEnd) },
    { tracePoint: pointToSegmentClosestPoint(edgeStart, start, end), obstaclePoint: edgeStart },
    { tracePoint: pointToSegmentClosestPoint(edgeEnd, start, end), obstaclePoint: edgeEnd },
  ]
  let best = candidates[0]!
  let bestDistanceSquared = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const distanceSquared = (candidate.tracePoint.x - candidate.obstaclePoint.x) ** 2 +
      (candidate.tracePoint.y - candidate.obstaclePoint.y) ** 2
    if (distanceSquared < bestDistanceSquared) {
      best = candidate
      bestDistanceSquared = distanceSquared
    }
  }
  return {
    ...best,
    distance: segmentToSegmentMinDistance(start, end, edgeStart, edgeEnd),
  }
}

const getTraceObstacleClearance = (
  start: Point,
  end: Point,
  width: number,
  obstacle: IndexedObstacle,
): Clearance => {
  const traceRadius = width / 2
  let tracePoint: Point
  let obstaclePoint: Point
  let obstacleRadius = 0
  let shapeDistance: number
  if (obstacle.shape.kind === "circle") {
    obstacleRadius = obstacle.shape.radius
    obstaclePoint = obstacle.shape.center
    tracePoint = pointToSegmentClosestPoint(obstaclePoint, start, end)
    shapeDistance = segmentToCircleMinDistance(start, end, {
      ...obstaclePoint,
      radius: obstacleRadius,
    })
  } else {
    const polygon = obstacle.shape.points
    const intersections = polygon.flatMap((point, index) => {
      const intersection = getSegmentIntersection(
        start, end, point, polygon[(index + 1) % polygon.length]!,
      )
      return intersection ? [intersection] : []
    })
    if (intersections.length > 0) {
      const dx = end.x - start.x
      const dy = end.y - start.y
      intersections.sort((left, right) =>
        ((left.x - start.x) * dx + (left.y - start.y) * dy) -
        ((right.x - start.x) * dx + (right.y - start.y) * dy),
      )
      tracePoint = obstaclePoint = intersections[0]!
      shapeDistance = 0
    } else if (isPointInsidePolygon(start, polygon) || isPointInsidePolygon(end, polygon)) {
      tracePoint = obstaclePoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      shapeDistance = 0
    } else {
      let best = getClosestPointsBetweenSegments(start, end, polygon[0]!, polygon[1]!)
      for (let index = 1; index < polygon.length; index++) {
        const candidate = getClosestPointsBetweenSegments(
          start, end, polygon[index]!, polygon[(index + 1) % polygon.length]!,
        )
        if (candidate.distance < best.distance) best = candidate
      }
      tracePoint = best.tracePoint
      obstaclePoint = best.obstaclePoint
      shapeDistance = best.distance
    }
  }
  const dx = obstaclePoint.x - tracePoint.x
  const dy = obstaclePoint.y - tracePoint.y
  const distance = Math.hypot(dx, dy)
  const unitX = distance === 0 ? 0 : dx / distance
  const unitY = distance === 0 ? 0 : dy / distance
  return {
    gap: shapeDistance - traceRadius,
    center: {
      x: ((tracePoint.x + unitX * traceRadius) + (obstaclePoint.x - unitX * obstacleRadius)) / 2,
      y: ((tracePoint.y + unitY * traceRadius) + (obstaclePoint.y - unitY * obstacleRadius)) / 2,
    },
  }
}

const getTracePairCenter = (left: TraceSegment, right: TraceSegment): Point => {
  const a = left.start
  const b = right.start
  const va = { x: left.end.x - a.x, y: left.end.y - a.y }
  const vb = { x: right.end.x - b.x, y: right.end.y - b.y }
  const aa = va.x * va.x + va.y * va.y
  const bb = vb.x * vb.x + vb.y * vb.y
  if (aa === 0 || bb === 0) {
    const pointA = aa === 0 ? a : pointToSegmentClosestPoint(b, a, left.end)
    const pointB = bb === 0 ? b : pointToSegmentClosestPoint(a, b, right.end)
    return { x: (pointA.x + pointB.x) / 2, y: (pointA.y + pointB.y) / 2 }
  }
  const w = { x: a.x - b.x, y: a.y - b.y }
  const ab = va.x * vb.x + va.y * vb.y
  const aw = va.x * w.x + va.y * w.y
  const bw = vb.x * w.x + vb.y * w.y
  const denominator = aa * bb - ab * ab
  if (denominator < 1e-10) {
    // Preserve endpoint order for parallel ties: B's endpoints precede A's.
    const candidates = [
      { pointA: pointToSegmentClosestPoint(b, a, left.end), pointB: b },
      { pointA: pointToSegmentClosestPoint(right.end, a, left.end), pointB: right.end },
      { pointA: a, pointB: pointToSegmentClosestPoint(a, b, right.end) },
      { pointA: left.end, pointB: pointToSegmentClosestPoint(left.end, b, right.end) },
    ]
    let best = candidates[0]!
    let bestDistance = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      const distance = Math.sqrt((candidate.pointA.x - candidate.pointB.x) ** 2 +
        (candidate.pointA.y - candidate.pointB.y) ** 2)
      if (distance < bestDistance) {
        best = candidate
        bestDistance = distance
      }
    }
    return { x: (best.pointA.x + best.pointB.x) / 2, y: (best.pointA.y + best.pointB.y) / 2 }
  }
  let tA = Math.max(0, Math.min(1, (ab * bw - bb * aw) / denominator))
  let tB = Math.max(0, Math.min(1, (tA * ab + bw) / bb))
  tA = Math.max(0, Math.min(1, (tB * ab - aw) / aa))
  return {
    x: ((a.x + tA * va.x) + (b.x + tB * vb.x)) / 2,
    y: ((a.y + tA * va.y) + (b.y + tB * vb.y)) / 2,
  }
}

/**
 * Reuses original pad geometry while indexing candidate traces and vias.
 * Generic errors follow the reference spatial bucket discovery order because
 * the repair solver uses that order when selecting movable traces.
 * Typed pad-clearance scoring retains the reference evaluator's 0.4 mm bucket
 * eligibility using circuit-json-util bounds. Those bounds currently ignore
 * SMT pad rotation, so typed clearance has the same limitation as before.
 * Overlap detection always uses the actual rotated polygon geometry.
 */
export const createTraceObstacleClearanceEvaluator = (
  staticCircuitJson: AnyCircuitElement[],
): ObstacleClearanceEvaluator => {
  const pads = staticCircuitJson.filter(
    (element): element is Extract<PadOrVia, { type: "pcb_smtpad" | "pcb_plated_hole" }> =>
      element.type === "pcb_smtpad" || element.type === "pcb_plated_hole",
  ).sort((left, right) => Number(left.type === "pcb_plated_hole") - Number(right.type === "pcb_plated_hole"))
  const padIndex = new RBush<IndexedObstacle>()
  padIndex.load(pads.map(compileObstacle))

  return (circuitJson, connMap): DrcError[] => {
    const vias = circuitJson.filter(
      (element): element is Extract<PadOrVia, { type: "pcb_via" }> => element.type === "pcb_via",
    )
    const viaIndex = new RBush<IndexedObstacle>()
    viaIndex.load(vias.map((via, index) => compileObstacle(via, pads.length + index)))
    const overlaps = new Map<string, DrcError>()
    const typedOverlappingPairs = new Set<string>()
    const typedErrors = new Map<string, {
      error: DrcError
      gap: number
      segmentOrder: number
      traceOrder: number
      obstacleOrder: number
      bucketX: number
      bucketY: number
    }>()
    const traces = circuitJson.filter((element): element is PcbTrace => element.type === "pcb_trace")
    const segments: TraceSegment[] = []
    for (const [traceOrder, trace] of traces.entries()) {
      const portIds = Array.from(new Set(trace.route.flatMap((point) => point.route_type === "wire"
        ? [point.start_pcb_port_id, point.end_pcb_port_id].filter((id): id is string => Boolean(id))
        : [])))
      for (let index = 0; index < trace.route.length - 1; index++) {
        const start = trace.route[index]!
        const end = trace.route[index + 1]!
        if (start.route_type !== "wire" || end.route_type !== "wire" || start.layer !== end.layer) continue
        segments.push({
          start, end, trace, traceOrder, portIds,
          width: start.width ?? end.width ?? 0.1,
          layer: start.layer,
          order: segments.length,
          minX: Math.min(start.x, end.x),
          minY: Math.min(start.y, end.y),
          maxX: Math.max(start.x, end.x),
          maxY: Math.max(start.y, end.y),
        })
      }
    }
    const segmentIndex = new RBush<TraceSegment>()
    segmentIndex.load(segments)
    let primarySegmentOrder = 0
    for (const [traceOrder, trace] of traces.entries()) {
      const firstPoint = trace.route[0]
      const lastPoint = trace.route.at(-1)
      if (!firstPoint || !lastPoint) continue
      const tracePortIds = Array.from(new Set(trace.route.flatMap((point) => [
        ...("start_pcb_port_id" in point && point.start_pcb_port_id ? [point.start_pcb_port_id] : []),
        ...("end_pcb_port_id" in point && point.end_pcb_port_id ? [point.end_pcb_port_id] : []),
      ])))
      for (let index = 0; index < trace.route.length - 1; index++) {
        const start = trace.route[index]!
        const end = trace.route[index + 1]!
        if (start.route_type !== "wire" || end.route_type !== "wire" || start.layer !== end.layer) continue
        const primarySegment = segments[primarySegmentOrder++]!
        const width = start.width ?? end.width ?? 0.1
        const margin = width / 2 + TRACE_CLEARANCE
        const bounds = {
          minX: Math.min(start.x, end.x) - margin,
          minY: Math.min(start.y, end.y) - margin,
          maxX: Math.max(start.x, end.x) + margin,
          maxY: Math.max(start.y, end.y) + margin,
        }
        const minBucketX = Math.floor(bounds.minX / 0.4)
        const minBucketY = Math.floor(bounds.minY / 0.4)
        const maxBucketX = Math.floor(bounds.maxX / 0.4)
        const maxBucketY = Math.floor(bounds.maxY / 0.4)
        const bucketBounds = {
          minX: minBucketX * 0.4,
          minY: minBucketY * 0.4,
          maxX: (maxBucketX + 1) * 0.4,
          maxY: (maxBucketY + 1) * 0.4,
        }
        const candidates: Array<TraceSegment | IndexedObstacle> = [
          ...segmentIndex.search(bucketBounds),
          ...padIndex.search(bucketBounds),
          ...viaIndex.search(bucketBounds),
        ].filter((item) =>
          Math.floor(item.minX / 0.4) <= maxBucketX &&
          Math.floor(item.maxX / 0.4) >= minBucketX &&
          Math.floor(item.minY / 0.4) <= maxBucketY &&
          Math.floor(item.maxY / 0.4) >= minBucketY,
        ).sort((left, right) =>
          Math.max(minBucketX, Math.floor(left.minX / 0.4)) - Math.max(minBucketX, Math.floor(right.minX / 0.4)) ||
          Math.max(minBucketY, Math.floor(left.minY / 0.4)) - Math.max(minBucketY, Math.floor(right.minY / 0.4)) ||
          (left.order + ("trace" in left ? 0 : segments.length)) - (right.order + ("trace" in right ? 0 : segments.length)),
        )
        for (const obstacle of candidates) {
          if ("trace" in obstacle) {
            if ((start.x === end.x && start.y === end.y) || obstacle.layer !== start.layer) continue
            const otherId = obstacle.trace.pcb_trace_id
            if (connMap.areIdsConnected(trace.pcb_trace_id, otherId)) continue
            const pairId = `${trace.pcb_trace_id}_${otherId}`
            if (overlaps.has(pairId) || overlaps.has(`${otherId}_${trace.pcb_trace_id}`)) continue
            const gap = segmentToSegmentMinDistance(start, end, obstacle.start, obstacle.end) - width / 2 - obstacle.width / 2
            if (gap > TRACE_CLEARANCE - DRC_EPSILON) continue
            const traceName = getReadableNameForElement(circuitJson, trace.pcb_trace_id)
            const otherName = getReadableNameForElement(circuitJson, otherId)
            overlaps.set(pairId, {
              type: "pcb_trace_error",
              error_type: "pcb_trace_error",
              message: gap <= 0
                ? `PCB trace ${traceName} overlaps with ${otherName} (accidental contact)`
                : `PCB trace ${traceName} is too close to ${otherName} (gap: ${gap.toFixed(3)}mm)`,
              pcb_trace_id: trace.pcb_trace_id,
              source_trace_id: "",
              pcb_trace_error_id: `overlap_${pairId}`,
              pcb_component_ids: [],
              pcb_port_ids: Array.from(new Set([...tracePortIds, ...obstacle.portIds])),
              center: getTracePairCenter(primarySegment, obstacle),
            })
            continue
          }
          if (!obstacle.layers.includes(start.layer)) continue
          if (connMap.areIdsConnected(trace.pcb_trace_id, obstacle.id)) continue
          const { gap, center } = getTraceObstacleClearance(start, end, width, obstacle)
          const pairId = `${trace.pcb_trace_id}_${obstacle.id}`
          const overlapId = `overlap_${pairId}`
          const element = obstacle.element
          const padBounds = obstacle.clearanceBounds
          const typedEligible = element.type === "pcb_via" || (
            Math.floor(bounds.minX / 0.4) <= Math.floor(padBounds.maxX / 0.4) &&
            Math.floor(bounds.maxX / 0.4) >= Math.floor(padBounds.minX / 0.4) &&
            Math.floor(bounds.minY / 0.4) <= Math.floor(padBounds.maxY / 0.4) &&
            Math.floor(bounds.maxY / 0.4) >= Math.floor(padBounds.minY / 0.4)
          )
          if (gap <= 0) {
            if (typedEligible) {
              typedErrors.delete(pairId)
              typedOverlappingPairs.add(pairId)
            }
            // The reference overlap evaluator skips zero-length segments.
            if ((start.x === end.x && start.y === end.y) || overlaps.has(pairId)) continue
            overlaps.set(pairId, {
              type: "pcb_trace_error",
              error_type: "pcb_trace_error",
              message: `PCB trace ${getReadableNameForElement(circuitJson, trace.pcb_trace_id)} overlaps with ${element.type} "${getReadableNameForElement(circuitJson, obstacle.id)}" (accidental contact)`,
              pcb_trace_id: trace.pcb_trace_id,
              source_trace_id: "",
              pcb_trace_error_id: overlapId,
              center,
              pcb_component_ids: "pcb_component_id" in element && element.pcb_component_id ? [element.pcb_component_id] : [],
              pcb_port_ids: [...tracePortIds, ...("pcb_port_id" in element && element.pcb_port_id ? [element.pcb_port_id] : [])],
            })
            continue
          }
          if (!typedEligible || typedOverlappingPairs.has(pairId) || gap + DRC_EPSILON >= TRACE_CLEARANCE) continue
          const current = typedErrors.get(pairId)
          if (current && gap >= current.gap) continue
          const isVia = element.type === "pcb_via"
          const type = isVia ? "pcb_via_trace_clearance_error" : "pcb_pad_trace_clearance_error"
          const error: DrcError = {
            type,
            error_type: type,
            [isVia ? "pcb_via_trace_clearance_error_id" : "pcb_pad_trace_clearance_error_id"]:
              `${isVia ? "via" : "pad"}_trace_clearance_${obstacle.id}_${trace.pcb_trace_id}`,
            [isVia ? "pcb_via_id" : "pcb_pad_id"]: obstacle.id,
            pcb_trace_id: trace.pcb_trace_id,
            minimum_clearance: TRACE_CLEARANCE,
            actual_clearance: gap,
            message: `${isVia ? "Via" : "Pad"} ${getReadableNameForElement(circuitJson, obstacle.id)} and trace ${getReadableNameForElement(circuitJson, trace.pcb_trace_id)} are too close (clearance: ${Number((Math.round(gap * 1000) / 1000).toFixed(3))}mm, minimum: ${TRACE_CLEARANCE}mm)`,
            center: isVia
              ? { x: element.x, y: element.y }
              : {
                  x: (("x" in firstPoint ? firstPoint.x : firstPoint.start.x) + ("x" in lastPoint ? lastPoint.x : lastPoint.end.x)) / 2,
                  y: (("y" in firstPoint ? firstPoint.y : firstPoint.start.y) + ("y" in lastPoint ? lastPoint.y : lastPoint.end.y)) / 2,
                },
          }
          typedErrors.set(pairId, {
            error, gap,
            segmentOrder: current?.segmentOrder ?? primarySegment.order,
            traceOrder,
            obstacleOrder: obstacle.order,
            bucketX: current?.bucketX ?? Math.max(minBucketX, Math.floor(padBounds.minX / 0.4)),
            bucketY: current?.bucketY ?? Math.max(minBucketY, Math.floor(padBounds.minY / 0.4)),
          })
        }
      }
    }
    const clearances = [...typedErrors.values()]
    return [
      ...overlaps.values(),
      ...clearances.filter(({ error }) => error.type === "pcb_via_trace_clearance_error")
        .sort((left, right) => left.obstacleOrder - right.obstacleOrder || left.traceOrder - right.traceOrder)
        .map(({ error }) => error),
      ...clearances.filter(({ error }) => error.type === "pcb_pad_trace_clearance_error")
        .sort((left, right) => left.segmentOrder - right.segmentOrder || left.bucketX - right.bucketX || left.bucketY - right.bucketY || left.obstacleOrder - right.obstacleOrder)
        .map(({ error }) => error),
    ]
  }
}
