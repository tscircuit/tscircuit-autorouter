import type { Obstacle, SimpleRouteJson } from "lib/types"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"
import type { SharedEdge } from "./types"

export type EdgeInterval = [number, number]
type Point = { x: number; y: number }
type ParametricLine = Point & { dx: number; dy: number; length: number }
type ImportedObstacle = Omit<Obstacle, "type" | "shape"> & {
  type: string
  shape?: string
  points?: Point[]
  outline?: Point[]
}

export function mergeEdgeIntervals(intervals: EdgeInterval[]): EdgeInterval[] {
  const merged: EdgeInterval[] = []
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
    if (end < start) continue
    const previous = merged.at(-1)
    if (previous && start < previous[1])
      previous[1] = Math.max(previous[1], end)
    else merged.push([start, end])
  }
  return merged
}

export function subtractEdgeIntervals(
  allowed: EdgeInterval[],
  blocked: EdgeInterval[],
): EdgeInterval[] {
  let result = allowed
  for (const [start, end] of mergeEdgeIntervals(blocked)) {
    result = result.flatMap(([low, high]): EdgeInterval[] => {
      if (end <= low || start >= high) return [[low, high]]
      const parts: EdgeInterval[] = []
      if (start >= low) parts.push([low, Math.min(start, high)])
      if (end <= high) parts.push([Math.max(end, low), high])
      return parts
    })
  }
  return result.filter(([low, high]) => high >= low)
}

function getLine(edge: SharedEdge): ParametricLine {
  if (
    ![edge.x1, edge.y1, edge.x2, edge.y2, edge.length].every(Number.isFinite) ||
    !(edge.length > 0) ||
    Math.abs(Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1) - edge.length) > 1e-6
  ) throw new Error(`Invalid physical shared edge "${edge.ownerPairKey}"`)
  return {
    x: edge.x1, y: edge.y1, length: edge.length,
    dx: (edge.x2 - edge.x1) / edge.length,
    dy: (edge.y2 - edge.y1) / edge.length,
  }
}

function clipBox(
  line: ParametricLine,
  minX: number, maxX: number, minY: number, maxY: number,
  closedBoardBounds = false,
): EdgeInterval[] {
  if (minX > maxX || minY > maxY) return []
  let low = closedBoardBounds ? 0 : -Infinity
  let high = closedBoardBounds ? line.length : Infinity
  for (const [origin, direction, minimum, maximum] of [
    [line.x, line.dx, minX, maxX], [line.y, line.dy, minY, maxY],
  ]) {
    if (direction === 0) {
      if (closedBoardBounds
        ? origin! < minimum! || origin! > maximum!
        : origin! <= minimum! || origin! >= maximum!) return []
      continue
    }
    const first = (minimum! - origin!) / direction!
    const second = (maximum! - origin!) / direction!
    low = Math.max(low, Math.min(first, second))
    high = Math.min(high, Math.max(first, second))
  }
  return high >= low ? [[low, high]] : []
}

function clipCircle(
  line: ParametricLine,
  center: Point,
  radius: number,
): EdgeInterval[] {
  const x = line.x - center.x, y = line.y - center.y
  const squaredDirection = line.dx * line.dx + line.dy * line.dy
  const projection = x * line.dx + y * line.dy
  const perpendicular = x * line.dy - y * line.dx
  const discriminant = radius * radius * squaredDirection - perpendicular * perpendicular
  if (discriminant <= 0) return []
  const reach = Math.sqrt(discriminant)
  const low = (-projection - reach) / squaredDirection
  const high = (-projection + reach) / squaredDirection
  return high >= low ? [[low, high]] : []
}

function localLine(line: ParametricLine, center: Point, angle: number): ParametricLine {
  const cosine = Math.cos(angle), sine = Math.sin(angle)
  const x = line.x - center.x, y = line.y - center.y
  return {
    x: x * cosine + y * sine, y: -x * sine + y * cosine,
    dx: line.dx * cosine + line.dy * sine,
    dy: -line.dx * sine + line.dy * cosine,
    length: line.length,
  }
}

function roundedRectangle(
  line: ParametricLine,
  halfWidth: number,
  halfHeight: number,
  radius: number,
): EdgeInterval[] {
  const intervals = [
    ...clipBox(line, -halfWidth - radius, halfWidth + radius, -halfHeight, halfHeight),
    ...clipBox(line, -halfWidth, halfWidth, -halfHeight - radius, halfHeight + radius),
  ]
  for (const x of [-halfWidth, halfWidth]) {
    for (const y of [-halfHeight, halfHeight])
      intervals.push(...clipCircle(line, { x, y }, radius))
  }
  return mergeEdgeIntervals(intervals)
}

function capsuleIntervals(line: ParametricLine, start: Point, end: Point, radius: number): EdgeInterval[] {
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (length === 0) return clipCircle(line, start, radius)
  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const local = localLine(line, center, Math.atan2(end.y - start.y, end.x - start.x))
  return mergeEdgeIntervals([
    ...clipBox(local, -length / 2, length / 2, -radius, radius),
    ...clipCircle(local, { x: -length / 2, y: 0 }, radius),
    ...clipCircle(local, { x: length / 2, y: 0 }, radius),
  ])
}

function polygonInteriorIntervals(line: ParametricLine, polygon: Point[]): EdgeInterval[] {
  const cuts: number[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!
    const x = b.x - a.x, y = b.y - a.y
    const denominator = line.dx * y - line.dy * x
    if (denominator === 0) continue
    const dx = a.x - line.x, dy = a.y - line.y
    const t = (dx * y - dy * x) / denominator
    const u = (dx * line.dy - dy * line.dx) / denominator
    if (u >= 0 && u <= 1) cuts.push(t)
  }
  cuts.sort((a, b) => a - b)
  const intervals: EdgeInterval[] = []
  for (let i = 1; i < cuts.length; i++) {
    const low = cuts[i - 1]!, high = cuts[i]!, middle = (low + high) / 2
    if (isPointInOrOnPolygon({ x: line.x + line.dx * middle, y: line.y + line.dy * middle }, polygon))
      intervals.push([low, high])
  }
  return mergeEdgeIntervals(intervals)
}

/** Exact intersection with copper expanded by a circular trace/clearance radius. */
export function getSharedEdgeObstacleIntervals(
  edge: SharedEdge,
  input: Obstacle,
  radius: number,
): EdgeInterval[] {
  const obstacle = input as ImportedObstacle
  const line = getLine(edge)
  if (!Number.isFinite(radius) || radius < 0) throw new Error("Invalid physical port radius")
  if (radius === 0) return []
  const polygon = obstacle.type === "polygon" ? obstacle.points ?? obstacle.outline : undefined
  if (polygon) {
    if (polygon.length < 3 || !polygon.every((point) => [point.x, point.y].every(Number.isFinite)))
      throw new Error("Invalid physical polygon obstacle")
    return mergeEdgeIntervals([
      ...polygonInteriorIntervals(line, polygon),
      ...polygon.flatMap((point, index) => capsuleIntervals(line, point, polygon[(index + 1) % polygon.length]!, radius)),
    ])
  }
  const { center, width, height } = obstacle
  const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
  if (![center.x, center.y, width, height, angle].every(Number.isFinite) || width < 0 || height < 0)
    throw new Error(`Invalid physical obstacle "${obstacle.obstacleId ?? "unknown"}"`)
  if (obstacle.shape === "circle" || obstacle.type === "circle") {
    if (Math.abs(width - height) > 1e-8) throw new Error("Noncircular physical circle obstacle")
    return clipCircle(line, center, width / 2 + radius)
  }
  const local = localLine(line, center, angle)
  if (obstacle.type === "oval" || obstacle.shape === "oval") {
    const halfWidth = width / 2, halfHeight = height / 2
    const small = Math.min(halfWidth, halfHeight)
    return capsuleIntervals(local,
      halfWidth >= halfHeight ? { x: -(halfWidth - small), y: 0 } : { x: 0, y: -(halfHeight - small) },
      halfWidth >= halfHeight ? { x: halfWidth - small, y: 0 } : { x: 0, y: halfHeight - small },
      small + radius)
  }
  if (obstacle.type !== "rect" || (obstacle.shape !== undefined && obstacle.shape !== "rect"))
    throw new Error(`Unsupported physical obstacle geometry "${obstacle.type}/${obstacle.shape}"`)
  return roundedRectangle(local, width / 2, height / 2, radius)
}

/** Board interior after accounting for the trace's physical copper radius. */
export function getSharedEdgeBoardIntervals(
  edge: SharedEdge,
  srj: SimpleRouteJson,
  copperRadius: number,
): EdgeInterval[] {
  const line = getLine(edge)
  const radius = copperRadius + (srj.minBoardEdgeClearance ?? 0)
  const { bounds, outline } = srj
  if (![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, radius].every(Number.isFinite) || radius < 0)
    throw new Error("Invalid physical board bounds or edge clearance")
  let allowed = clipBox(line, bounds.minX + radius, bounds.maxX - radius, bounds.minY + radius, bounds.maxY - radius, true)
  if (!outline) return allowed
  if (outline.length < 3 || !outline.every((point) => [point.x, point.y].every(Number.isFinite)))
    throw new Error("Invalid physical board outline")
  const inside = polygonInteriorIntervals(line, outline)
  allowed = allowed.flatMap(([low, high]) => inside.flatMap(([a, b]): EdgeInterval[] => Math.min(high, b) >= Math.max(low, a) ? [[Math.max(low, a), Math.min(high, b)]] : []))
  return subtractEdgeIntervals(allowed, outline.flatMap((point, index) => capsuleIntervals(line, point, outline[(index + 1) % outline.length]!, Math.max(0, radius - 1e-6))))
}
