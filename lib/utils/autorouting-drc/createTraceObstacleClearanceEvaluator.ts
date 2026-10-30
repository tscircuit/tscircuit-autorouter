import { getBoundsOfPcbElements } from "@tscircuit/circuit-json-util"
import {
  Arc,
  Circle,
  Point as FlattenPoint,
  Polygon,
  Segment,
  Vector,
} from "@flatten-js/core"
import {
  getSegmentIntersection,
  isPointInsidePolygon,
  pointToSegmentClosestPoint,
  pointToSegmentDistance,
  segmentToCircleMinDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import { all_layers, type AnyCircuitElement, type PcbTrace } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import RBush from "rbush"
import { formatMm } from "format-si-unit"
import {
  getDrcReadableElementName as getReadableNameForElement,
  getDrcReadableTraceName,
} from "./drcReadableNames"

type Point = { x: number; y: number }
type PadOrVia = Extract<
  AnyCircuitElement,
  { type: "pcb_smtpad" | "pcb_plated_hole" | "pcb_via" | "pcb_hole" }
>
export type IndexedObstacle = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  id: string
  order: number
  layers: string[]
  element: PadOrVia
  holePolygon?: Polygon
  clearanceBounds: { minX: number; minY: number; maxX: number; maxY: number }
  shape:
    | { kind: "circle"; center: Point; radius: number }
    | {
        kind: "polygon"
        points: Point[]
        radius?: number
      }
    | {
        kind: "capsule"
        start: Point
        end: Point
        radius: number
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
  typedWidth?: number
}
type DrcError = Record<string, unknown>
export type TraceClearanceErrorGroups = {
  traceErrors: DrcError[]
  viaErrors: DrcError[]
  padErrors: DrcError[]
  holeErrors: DrcError[]
}
type ObstacleClearanceEvaluator = (
  circuitJson: AnyCircuitElement[],
  connMap: ConnectivityMap,
) => TraceClearanceErrorGroups

const TRACE_CLEARANCE = 0.1
const DRC_EPSILON = 5e-3

export const compileTraceClearanceObstacle = (
  element: PadOrVia,
  order: number,
): IndexedObstacle => {
  const id =
    element.type === "pcb_via"
      ? element.pcb_via_id
      : element.type === "pcb_smtpad"
        ? element.pcb_smtpad_id
        : element.type === "pcb_hole"
          ? element.pcb_hole_id
          : element.pcb_plated_hole_id
  const layers =
    element.type === "pcb_smtpad"
      ? [element.layer]
      : element.type === "pcb_hole"
        ? [...all_layers]
        : element.layers
  const clearanceBounds = getBoundsOfPcbElements([element])
  if (element.type === "pcb_smtpad" && element.shape === "polygon") {
    return {
      id,
      order,
      layers,
      element,
      clearanceBounds,
      minX: Math.min(...element.points.map((point) => point.x)),
      minY: Math.min(...element.points.map((point) => point.y)),
      maxX: Math.max(...element.points.map((point) => point.x)),
      maxY: Math.max(...element.points.map((point) => point.y)),
      shape: { kind: "polygon", points: element.points },
    }
  }
  if (
    element.type === "pcb_via" ||
    (element.type === "pcb_hole"
      ? element.hole_shape === "circle"
      : element.shape === "circle")
  ) {
    const radius =
      element.type === "pcb_via"
        ? element.outer_diameter / 2
        : element.type === "pcb_hole" && element.hole_shape === "circle"
          ? element.hole_diameter / 2
          : element.type === "pcb_smtpad" && element.shape === "circle"
            ? element.radius
            : (
                element as Extract<PadOrVia, { type: "pcb_plated_hole" }> & {
                  outer_diameter: number
                }
              ).outer_diameter / 2
    return {
      id,
      order,
      layers,
      element,
      clearanceBounds,
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
  let radius = 0
  let capsule = false
  if (
    element.type === "pcb_smtpad" &&
    (element.shape === "rect" || element.shape === "rotated_rect")
  ) {
    width = element.width
    height = element.height
    rotation = element.shape === "rotated_rect" ? element.ccw_rotation : 0
    radius = Math.max(
      0,
      Math.min(element.corner_radius ?? 0, width / 2, height / 2),
    )
    capsule = radius > 0 && radius === Math.min(width, height) / 2
  } else if (
    element.type === "pcb_smtpad" &&
    (element.shape === "pill" || element.shape === "rotated_pill")
  ) {
    width = element.width
    height = element.height
    radius = element.radius
    rotation = element.shape === "rotated_pill" ? element.ccw_rotation : 0
    capsule = true
  } else if (
    element.type === "pcb_plated_hole" &&
    (element.shape === "oval" || element.shape === "pill")
  ) {
    width = element.outer_width
    height = element.outer_height
    radius = Math.min(width, height) / 2
    rotation = element.ccw_rotation
    capsule = true
  } else if (element.type === "pcb_hole") {
    width = "hole_width" in element ? element.hole_width : element.hole_diameter
    height =
      "hole_height" in element ? element.hole_height : element.hole_diameter
    rotation = element.hole_shape === "rotated_pill" ? element.ccw_rotation : 0
    capsule =
      element.hole_shape === "pill" || element.hole_shape === "rotated_pill"
    radius = capsule ? Math.min(width, height) / 2 : 0
  } else if (
    element.type === "pcb_plated_hole" &&
    "rect_pad_width" in element &&
    "rect_pad_height" in element
  ) {
    width = element.rect_pad_width
    height = element.rect_pad_height
    rotation =
      "rect_ccw_rotation" in element &&
      typeof element.rect_ccw_rotation === "number"
        ? element.rect_ccw_rotation
        : 0
  } else {
    throw new Error(
      `Unsupported autorouting DRC obstacle shape: ${element.type}`,
    )
  }
  const angle = (rotation * Math.PI) / 180
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const outerPoints = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ].map((point) => ({
    x: element.x + (point.x * cosine - point.y * sine),
    y: element.y + (point.x * sine + point.y * cosine),
  }))
  let shape: IndexedObstacle["shape"]
  if (capsule) {
    const halfLine = Math.max(Math.max(width, height) / 2 - radius, 0)
    const dx = width >= height ? halfLine * cosine : -halfLine * sine
    const dy = width >= height ? halfLine * sine : halfLine * cosine
    shape = {
      kind: "capsule",
      start: { x: element.x - dx, y: element.y - dy },
      end: { x: element.x + dx, y: element.y + dy },
      radius,
    }
  } else {
    const points =
      radius === 0
        ? outerPoints
        : [
            { x: -width / 2 + radius, y: -height / 2 + radius },
            { x: width / 2 - radius, y: -height / 2 + radius },
            { x: width / 2 - radius, y: height / 2 - radius },
            { x: -width / 2 + radius, y: height / 2 - radius },
          ].map((point) => ({
            x: element.x + point.x * cosine - point.y * sine,
            y: element.y + point.x * sine + point.y * cosine,
          }))
    shape = { kind: "polygon", points, radius }
  }
  let holePolygon: Polygon | undefined
  if (element.type === "pcb_hole") {
    if (element.hole_shape === "oval") {
      if (Math.abs(width - height) < 1e-9) {
        holePolygon = new Polygon(new Circle(new FlattenPoint(0, 0), width / 2))
      } else {
        const count = Math.max(
          16,
          Math.ceil(
            Math.PI /
              Math.acos(Math.max(-1, 1 - 1e-6 / (Math.max(width, height) / 2))),
          ),
        )
        holePolygon = new Polygon(
          Array.from(
            { length: count },
            (_, index) =>
              new FlattenPoint(
                (width / 2) * Math.cos((index * 2 * Math.PI) / count),
                (height / 2) * Math.sin((index * 2 * Math.PI) / count),
              ),
          ),
        )
      }
    } else if (!capsule) {
      holePolygon = new Polygon([
        new FlattenPoint(-width / 2, -height / 2),
        new FlattenPoint(width / 2, -height / 2),
        new FlattenPoint(width / 2, height / 2),
        new FlattenPoint(-width / 2, height / 2),
      ])
    } else {
      const corners = [
        new FlattenPoint(width / 2 - radius, -height / 2 + radius),
        new FlattenPoint(width / 2 - radius, height / 2 - radius),
        new FlattenPoint(-width / 2 + radius, height / 2 - radius),
        new FlattenPoint(-width / 2 + radius, -height / 2 + radius),
      ]
      const edges: Array<Arc | Segment> = []
      for (let index = 0; index < 4; index++) {
        const angle = -Math.PI / 2 + (index * Math.PI) / 2
        const arc = new Arc(
          corners[index]!,
          radius,
          angle,
          angle + Math.PI / 2,
          true,
        )
        const next = corners[(index + 1) % 4]!
        const nextStart = new FlattenPoint(
          next.x + radius * Math.cos(angle + Math.PI / 2),
          next.y + radius * Math.sin(angle + Math.PI / 2),
        )
        edges.push(arc)
        if (arc.end.distanceTo(nextStart)[0] > 1e-9)
          edges.push(new Segment(arc.end, nextStart))
      }
      holePolygon = new Polygon()
      holePolygon.addFace(edges)
    }
    holePolygon = holePolygon
      .rotate((rotation * Math.PI) / 180)
      .translate(new Vector(element.x, element.y))
  }
  const points = outerPoints
  const bounds = holePolygon
    ? {
        minX: holePolygon.box.xmin,
        minY: holePolygon.box.ymin,
        maxX: holePolygon.box.xmax,
        maxY: holePolygon.box.ymax,
      }
    : shape.kind === "capsule"
      ? {
          minX: Math.min(shape.start.x, shape.end.x) - shape.radius,
          minY: Math.min(shape.start.y, shape.end.y) - shape.radius,
          maxX: Math.max(shape.start.x, shape.end.x) + shape.radius,
          maxY: Math.max(shape.start.y, shape.end.y) + shape.radius,
        }
      : {
          minX: Math.min(...points.map((point) => point.x)),
          minY: Math.min(...points.map((point) => point.y)),
          maxX: Math.max(...points.map((point) => point.x)),
          maxY: Math.max(...points.map((point) => point.y)),
        }
  return {
    id,
    order,
    layers,
    element,
    clearanceBounds,
    holePolygon,
    ...bounds,
    shape,
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
    return {
      distance: 0,
      tracePoint: intersection,
      obstaclePoint: intersection,
    }
  }
  const candidates = [
    {
      tracePoint: start,
      obstaclePoint: pointToSegmentClosestPoint(start, edgeStart, edgeEnd),
    },
    {
      tracePoint: end,
      obstaclePoint: pointToSegmentClosestPoint(end, edgeStart, edgeEnd),
    },
    {
      tracePoint: pointToSegmentClosestPoint(edgeStart, start, end),
      obstaclePoint: edgeStart,
    },
    {
      tracePoint: pointToSegmentClosestPoint(edgeEnd, start, end),
      obstaclePoint: edgeEnd,
    },
  ]
  let best = candidates[0]!
  let bestDistanceSquared = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const distanceSquared =
      (candidate.tracePoint.x - candidate.obstaclePoint.x) ** 2 +
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

export const getTraceObstacleClearance = (
  start: Point,
  end: Point,
  width: number,
  obstacle: IndexedObstacle,
): Clearance => {
  const traceRadius = width / 2
  if (obstacle.element.type === "pcb_hole") {
    const hole = obstacle.element
    if (hole.hole_shape === "circle") {
      return {
        gap:
          pointToSegmentDistance(hole, start, end) -
          hole.hole_diameter / 2 -
          traceRadius,
        center: pointToSegmentClosestPoint(hole, start, end),
      }
    }
    if (!obstacle.holePolygon)
      throw new Error(`Missing compiled hole geometry for ${obstacle.id}`)
    const a = new FlattenPoint(start.x, start.y)
    const b = new FlattenPoint(end.x, end.y)
    const [distance, shortest] = obstacle.holePolygon.distanceTo(
      new Segment(a, b),
    )
    return {
      gap:
        (obstacle.holePolygon.contains(a) || obstacle.holePolygon.contains(b)
          ? 0
          : distance) - traceRadius,
      center: { x: shortest.end.x, y: shortest.end.y },
    }
  }
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
  } else if (obstacle.shape.kind === "capsule") {
    const closest = getClosestPointsBetweenSegments(
      start,
      end,
      obstacle.shape.start,
      obstacle.shape.end,
    )
    tracePoint = closest.tracePoint
    obstaclePoint = closest.obstaclePoint
    obstacleRadius = obstacle.shape.radius
    shapeDistance = closest.distance - obstacleRadius
  } else {
    const polygon = obstacle.shape.points
    obstacleRadius = obstacle.shape.radius ?? 0
    if (polygon.length < 3) return { gap: Infinity, center: start }
    const intersections = polygon.flatMap((point, index) => {
      const intersection = getSegmentIntersection(
        start,
        end,
        point,
        polygon[(index + 1) % polygon.length]!,
      )
      return intersection ? [intersection] : []
    })
    if (intersections.length > 0) {
      const dx = end.x - start.x
      const dy = end.y - start.y
      intersections.sort(
        (left, right) =>
          (left.x - start.x) * dx +
          (left.y - start.y) * dy -
          ((right.x - start.x) * dx + (right.y - start.y) * dy),
      )
      tracePoint = obstaclePoint = intersections[0]!
      shapeDistance = 0
    } else if (
      isPointInsidePolygon(start, polygon) ||
      isPointInsidePolygon(end, polygon)
    ) {
      tracePoint = obstaclePoint = {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      }
      shapeDistance = 0
    } else {
      let best = getClosestPointsBetweenSegments(
        start,
        end,
        polygon[0]!,
        polygon[1]!,
      )
      for (let index = 1; index < polygon.length; index++) {
        const candidate = getClosestPointsBetweenSegments(
          start,
          end,
          polygon[index]!,
          polygon[(index + 1) % polygon.length]!,
        )
        if (candidate.distance < best.distance) best = candidate
      }
      tracePoint = best.tracePoint
      obstaclePoint = best.obstaclePoint
      shapeDistance = best.distance
    }
    shapeDistance -= obstacleRadius
  }
  const dx = obstaclePoint.x - tracePoint.x
  const dy = obstaclePoint.y - tracePoint.y
  const distance = Math.hypot(dx, dy)
  const unitX = distance === 0 ? 0 : dx / distance
  const unitY = distance === 0 ? 0 : dy / distance
  if (distance > 0 && distance <= traceRadius + obstacleRadius) {
    const overlapStart = Math.max(-traceRadius, distance - obstacleRadius)
    const overlapEnd = Math.min(traceRadius, distance + obstacleRadius)
    const offset = (overlapStart + overlapEnd) / 2
    return {
      gap: shapeDistance - traceRadius,
      center: {
        x: tracePoint.x + unitX * offset,
        y: tracePoint.y + unitY * offset,
      },
    }
  }
  return {
    gap: shapeDistance - traceRadius,
    center: {
      x:
        (tracePoint.x +
          unitX * traceRadius +
          (obstaclePoint.x - unitX * obstacleRadius)) /
        2,
      y:
        (tracePoint.y +
          unitY * traceRadius +
          (obstaclePoint.y - unitY * obstacleRadius)) /
        2,
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
      {
        pointA: pointToSegmentClosestPoint(right.end, a, left.end),
        pointB: right.end,
      },
      { pointA: a, pointB: pointToSegmentClosestPoint(a, b, right.end) },
      {
        pointA: left.end,
        pointB: pointToSegmentClosestPoint(left.end, b, right.end),
      },
    ]
    let best = candidates[0]!
    let bestDistance = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      const distance = Math.sqrt(
        (candidate.pointA.x - candidate.pointB.x) ** 2 +
          (candidate.pointA.y - candidate.pointB.y) ** 2,
      )
      if (distance < bestDistance) {
        best = candidate
        bestDistance = distance
      }
    }
    return {
      x: (best.pointA.x + best.pointB.x) / 2,
      y: (best.pointA.y + best.pointB.y) / 2,
    }
  }
  let tA = Math.max(0, Math.min(1, (ab * bw - bb * aw) / denominator))
  let tB = Math.max(0, Math.min(1, (tA * ab + bw) / bb))
  tA = Math.max(0, Math.min(1, (tB * ab - aw) / aa))
  return {
    x: (a.x + tA * va.x + (b.x + tB * vb.x)) / 2,
    y: (a.y + tA * va.y + (b.y + tB * vb.y)) / 2,
  }
}

/** Keeps candidate ordering and geometry identical to the full-board evaluator. */
export const createTraceObstacleClearanceEvaluator = (
  staticCircuitJson: AnyCircuitElement[],
  options: { traceClearance?: number; holeClearance?: number } = {},
): ObstacleClearanceEvaluator => {
  const elements = staticCircuitJson
    .filter(
      (element): element is Exclude<PadOrVia, { type: "pcb_via" }> =>
        element.type === "pcb_smtpad" ||
        element.type === "pcb_plated_hole" ||
        element.type === "pcb_hole",
    )
    .sort((left, right) => {
      const rank = { pcb_smtpad: 0, pcb_plated_hole: 1, pcb_hole: 2 }
      return rank[left.type] - rank[right.type]
    })
  const obstacles = elements.map(compileTraceClearanceObstacle)
  const staticIndex = new RBush<IndexedObstacle>()
  staticIndex.load(obstacles)
  const padIndex = new RBush<IndexedObstacle>()
  padIndex.load(
    obstacles
      .filter((obstacle) => obstacle.element.type !== "pcb_hole")
      .map((obstacle) => ({ ...obstacle, ...obstacle.clearanceBounds })),
  )
  const holeIndex = new RBush<IndexedObstacle>()
  holeIndex.load(
    obstacles.filter((obstacle) => obstacle.element.type === "pcb_hole"),
  )

  return (circuitJson, connMap): TraceClearanceErrorGroups => {
    const board = circuitJson.find((element) => element.type === "pcb_board")
    const traceClearance =
      options.traceClearance ??
      board?.min_trace_to_pad_edge_clearance ??
      TRACE_CLEARANCE
    const holeClearance =
      options.holeClearance ?? board?.min_trace_to_hole_edge_clearance ?? 0.2
    if (!Number.isFinite(holeClearance) || holeClearance < 0) {
      throw new Error("Trace-to-hole clearance must be finite and non-negative")
    }
    const traces = circuitJson.filter(
      (element): element is PcbTrace => element.type === "pcb_trace",
    )
    const segments: TraceSegment[] = []
    for (const [traceOrder, trace] of traces.entries()) {
      const portIds = Array.from(
        new Set(
          trace.route.flatMap((point) =>
            point.route_type === "wire"
              ? [point.start_pcb_port_id, point.end_pcb_port_id].filter(
                  (id): id is string => Boolean(id),
                )
              : [],
          ),
        ),
      )
      for (let index = 0; index < trace.route.length - 1; index++) {
        const start = trace.route[index]!
        const end = trace.route[index + 1]!
        if (
          (start.route_type !== "wire" && start.route_type !== "via") ||
          (end.route_type !== "wire" && end.route_type !== "via")
        )
          continue
        const wire = start.route_type === "wire" ? start : end
        if (wire.route_type !== "wire") continue
        if (
          start.route_type === "wire" &&
          end.route_type === "wire" &&
          start.layer !== end.layer
        )
          continue
        segments.push({
          start,
          end,
          trace,
          traceOrder,
          portIds,
          width: Math.max(
            start.route_type === "wire" ? (start.width ?? 0.1) : 0,
            end.route_type === "wire" ? (end.width ?? 0.1) : 0,
          ),
          typedWidth:
            start.route_type === "wire" && end.route_type === "wire"
              ? (start.width ?? end.width ?? 0.1)
              : undefined,
          layer: wire.layer,
          order: segments.length,
          minX: Math.min(start.x, end.x),
          minY: Math.min(start.y, end.y),
          maxX: Math.max(start.x, end.x),
          maxY: Math.max(start.y, end.y),
        })
      }
    }
    const vias = circuitJson
      .filter(
        (element): element is Extract<PadOrVia, { type: "pcb_via" }> =>
          element.type === "pcb_via",
      )
      .map((via, index) =>
        compileTraceClearanceObstacle(via, obstacles.length + index),
      )
    const dynamicIndex = new RBush<TraceSegment | IndexedObstacle>()
    dynamicIndex.load([...segments, ...vias])
    const typedSegments = segments.filter(
      (segment) => segment.typedWidth !== undefined,
    )
    const typedSegmentIndex = new RBush<TraceSegment>()
    typedSegmentIndex.load(typedSegments)
    const maxTypedRadius = typedSegments.reduce(
      (maximum, segment) => Math.max(maximum, segment.typedWidth! / 2),
      0,
    )
    const overlaps = new Map<string, DrcError>()
    const getCandidates = (
      segment: TraceSegment,
      margin: number,
      indexes: Array<
        RBush<TraceSegment | IndexedObstacle> | RBush<IndexedObstacle>
      >,
    ): Array<TraceSegment | IndexedObstacle> => {
      const minBucketX = Math.floor((segment.minX - margin) / 0.4)
      const minBucketY = Math.floor((segment.minY - margin) / 0.4)
      const maxBucketX = Math.floor((segment.maxX + margin) / 0.4)
      const maxBucketY = Math.floor((segment.maxY + margin) / 0.4)
      const bounds = {
        minX: minBucketX * 0.4,
        minY: minBucketY * 0.4,
        maxX: (maxBucketX + 1) * 0.4,
        maxY: (maxBucketY + 1) * 0.4,
      }
      return indexes
        .flatMap((index) => index.search(bounds))
        .filter(
          (item) =>
            Math.floor(item.minX / 0.4) <= maxBucketX &&
            Math.floor(item.maxX / 0.4) >= minBucketX &&
            Math.floor(item.minY / 0.4) <= maxBucketY &&
            Math.floor(item.maxY / 0.4) >= minBucketY,
        )
        .sort(
          (left, right) =>
            Math.max(minBucketX, Math.floor(left.minX / 0.4)) -
              Math.max(minBucketX, Math.floor(right.minX / 0.4)) ||
            Math.max(minBucketY, Math.floor(left.minY / 0.4)) -
              Math.max(minBucketY, Math.floor(right.minY / 0.4)) ||
            left.order +
              ("trace" in left ? 0 : segments.length) -
              (right.order + ("trace" in right ? 0 : segments.length)),
        )
    }
    for (const segment of segments) {
      const { start, end, trace, width, portIds } = segment
      if (start.x === end.x && start.y === end.y) continue
      for (const item of getCandidates(segment, traceClearance + width / 2, [
        dynamicIndex,
        staticIndex,
      ])) {
        const otherId = "trace" in item ? item.trace.pcb_trace_id : item.id
        if (
          !("trace" in item ? [item.layer] : item.layers).includes(
            segment.layer,
          )
        )
          continue
        const connectedId =
          "trace" in item
            ? otherId
            : "pcb_trace_id" in item.element
              ? (item.element.pcb_trace_id as string)
              : otherId
        if (connMap.areIdsConnected(trace.pcb_trace_id, connectedId)) continue
        const pairId = `${trace.pcb_trace_id}_${otherId}`
        if (
          overlaps.has(pairId) ||
          ("trace" in item && overlaps.has(`${otherId}_${trace.pcb_trace_id}`))
        )
          continue
        const clearance =
          "trace" in item
            ? {
                gap:
                  segmentToSegmentMinDistance(
                    start,
                    end,
                    item.start,
                    item.end,
                  ) -
                  width / 2 -
                  item.width / 2,
                center: getTracePairCenter(segment, item),
              }
            : getTraceObstacleClearance(start, end, width, item)
        if (
          "trace" in item
            ? clearance.gap > traceClearance - DRC_EPSILON
            : clearance.gap > 0
        )
          continue
        const traceName = getReadableNameForElement(
          circuitJson,
          trace.pcb_trace_id,
        )
        const otherName =
          "trace" in item
            ? getReadableNameForElement(circuitJson, otherId)
            : `${item.element.type} "${getReadableNameForElement(circuitJson, otherId)}"`
        const hole = !("trace" in item) && item.element.type === "pcb_hole"
        overlaps.set(pairId, {
          type: "pcb_trace_error",
          error_type: "pcb_trace_error",
          message:
            clearance.gap <= 0
              ? `PCB trace ${traceName} overlaps with ${otherName} (accidental contact)`
              : `PCB trace ${traceName} is too close to ${otherName} (gap: ${clearance.gap.toFixed(3)}mm)`,
          pcb_trace_id: trace.pcb_trace_id,
          source_trace_id: hole ? (trace.source_trace_id ?? "") : "",
          pcb_trace_error_id: `overlap_${pairId}`,
          pcb_component_ids:
            !("trace" in item) &&
            "pcb_component_id" in item.element &&
            item.element.pcb_component_id
              ? [item.element.pcb_component_id]
              : [],
          pcb_port_ids:
            "trace" in item
              ? Array.from(new Set([...portIds, ...item.portIds]))
              : [
                  ...portIds,
                  ...("pcb_port_id" in item.element && item.element.pcb_port_id
                    ? [item.element.pcb_port_id]
                    : []),
                ],
          center: clearance.center,
        })
      }
    }
    const typedErrors = new Map<string, { error: DrcError; gap: number }>()
    const overlappingTypedPairs = new Set<string>()
    const evaluateTypedPair = (
      segment: TraceSegment,
      obstacle: IndexedObstacle,
    ): void => {
      if (
        !obstacle.layers.includes(segment.layer) ||
        connMap.areIdsConnected(segment.trace.pcb_trace_id, obstacle.id)
      )
        return
      const pairId = `${obstacle.id}_${segment.trace.pcb_trace_id}`
      const { gap, center } = getTraceObstacleClearance(
        segment.start,
        segment.end,
        segment.typedWidth!,
        obstacle,
      )
      if (gap <= 0) {
        typedErrors.delete(pairId)
        overlappingTypedPairs.add(pairId)
        return
      }
      if (
        overlappingTypedPairs.has(pairId) ||
        gap + DRC_EPSILON >= traceClearance ||
        (typedErrors.get(pairId)?.gap ?? Infinity) <= gap
      )
        return
      const isVia = obstacle.element.type === "pcb_via"
      const type = isVia
        ? "pcb_via_trace_clearance_error"
        : "pcb_pad_trace_clearance_error"
      typedErrors.set(pairId, {
        gap,
        error: {
          type,
          error_type: type,
          [isVia
            ? "pcb_via_trace_clearance_error_id"
            : "pcb_pad_trace_clearance_error_id"]:
            `${isVia ? "via" : "pad"}_trace_clearance_${pairId}`,
          [isVia ? "pcb_via_id" : "pcb_pad_id"]: obstacle.id,
          pcb_trace_id: segment.trace.pcb_trace_id,
          minimum_clearance: traceClearance,
          actual_clearance: gap,
          message: `${isVia ? "Via" : "Pad"} ${getReadableNameForElement(circuitJson, obstacle.id)} and trace ${getReadableNameForElement(circuitJson, segment.trace.pcb_trace_id)} are too close (clearance: ${formatMm(gap)}, minimum: ${formatMm(traceClearance)})`,
          center,
        },
      })
    }
    for (const via of vias) {
      const margin = traceClearance + maxTypedRadius + DRC_EPSILON
      const nearbySegments = typedSegmentIndex
        .search({
          minX: via.minX - margin,
          minY: via.minY - margin,
          maxX: via.maxX + margin,
          maxY: via.maxY + margin,
        })
        .sort((left, right) => left.order - right.order)
      for (const segment of nearbySegments) evaluateTypedPair(segment, via)
    }
    for (const segment of typedSegments) {
      for (const obstacle of getCandidates(
        segment,
        traceClearance + segment.typedWidth! / 2,
        [padIndex],
      )) {
        if ("trace" in obstacle)
          throw new Error("Unexpected trace in pad index")
        evaluateTypedPair(segment, obstacle)
      }
    }
    const holeErrors = new Map<string, { gap: number; error: DrcError }>()
    const overlappingHolePairs = new Set<string>()
    for (const segment of segments) {
      for (const obstacle of getCandidates(
        segment,
        holeClearance + segment.width / 2,
        [holeIndex],
      )) {
        if ("trace" in obstacle || obstacle.element.type !== "pcb_hole")
          throw new Error("Unexpected geometry in hole index")
        const { gap, center } = getTraceObstacleClearance(
          segment.start,
          segment.end,
          segment.width,
          obstacle,
        )
        const pairId = `${segment.trace.pcb_trace_id}_${obstacle.id}`
        if (gap <= 0) {
          holeErrors.delete(pairId)
          overlappingHolePairs.add(pairId)
          continue
        }
        if (
          overlappingHolePairs.has(pairId) ||
          gap + 1e-6 >= holeClearance ||
          (holeErrors.get(pairId)?.gap ?? Infinity) <= gap
        )
          continue
        holeErrors.set(pairId, {
          gap,
          error: {
            type: "pcb_trace_error",
            error_type: "pcb_trace_error",
            pcb_trace_error_id: `overlap_${pairId}`,
            pcb_trace_id: segment.trace.pcb_trace_id,
            source_trace_id: segment.trace.source_trace_id ?? "",
            pcb_component_ids: obstacle.element.pcb_component_id
              ? [obstacle.element.pcb_component_id]
              : [],
            pcb_port_ids: [],
            center,
            message: `Trace ${getDrcReadableTraceName(circuitJson, segment.trace.pcb_trace_id)} is too close to non-plated hole ${getReadableNameForElement(circuitJson, obstacle.id)} (gap: ${gap.toFixed(6)}mm, required: ${holeClearance}mm)`,
          },
        })
      }
    }
    const clearances = Array.from(typedErrors.values(), ({ error }) => error)
    return {
      traceErrors: [...overlaps.values()],
      viaErrors: clearances.filter(
        (error) => error.type === "pcb_via_trace_clearance_error",
      ),
      padErrors: clearances.filter(
        (error) => error.type === "pcb_pad_trace_clearance_error",
      ),
      holeErrors: Array.from(holeErrors.values(), ({ error }) => error),
    }
  }
}
