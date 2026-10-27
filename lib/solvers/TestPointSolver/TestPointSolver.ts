import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../types"
import { convertSrjToGraphicsObject } from "../../utils/convertSrjToGraphicsObject"

type Point = { x: number; y: number }
type Wire = Extract<SimplifiedPcbTrace["route"][number], { route_type: "wire" }>
export type TestPointRequest = {
  name: string
  pcbTraceId: string
  layer: "top" | "bottom"
  diameter: number
}
/** Board coordinates in mm, +X right, +Y up; layer identifies the probe face. */
export type RoutedTestPoint = Point & TestPointRequest & {
  connectionName: string
}
export type TestPointOptions = {
  requests: TestPointRequest[]
  clearance: number
  minProbeSpacing: number
  /** Maximum perpendicular displacement of a local trace detour, mm. Zero disables detours. */
  maxDetour: number
  sampleStep?: number
}
export type TestPointOutput = SimpleRouteJson & { testPoints: RoutedTestPoint[] }

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const squaredLength = dx * dx + dy * dy
  const t = squaredLength === 0 ? 0 : Math.max(0, Math.min(1,
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / squaredLength))
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const cross = (p: Point, q: Point, r: Point): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  if (cross(a, b, c) * cross(a, b, d) < 0 &&
      cross(c, d, a) * cross(c, d, b) < 0) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}

/** Opt-in post-routing phase. One requested test point is placed per step.
 * Preserves all other traces and refuses to emit a partial successful result.
 * Searches inline candidates first, then bounded triangular local detours.
 */
export class TestPointSolver extends BaseSolver {
  private output: TestPointOutput
  private requestIndex = 0

  constructor(private input: SimpleRouteJson, private options: TestPointOptions) {
    super()
    for (const [name, value] of Object.entries({ clearance: options.clearance,
      minProbeSpacing: options.minProbeSpacing, maxDetour: options.maxDetour })) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and nonnegative`)
    }
    if (!Number.isFinite(options.sampleStep ?? 0.25) || (options.sampleStep ?? 0.25) <= 0) {
      throw new Error("sampleStep must be finite and positive")
    }
    if (new Set(options.requests.map((r) => r.name)).size !== options.requests.length) {
      throw new Error("Test point names must be unique")
    }
    for (const request of options.requests) {
      if (!request.name || !Number.isFinite(request.diameter) || request.diameter <= 0 ||
        !["top", "bottom"].includes(request.layer)) throw new Error("Invalid test point request")
      if (input.traces?.filter((t) => t.pcb_trace_id === request.pcbTraceId).length !== 1) {
        throw new Error(`Test point ${request.name} requires one existing trace`)
      }
    }
    if (input.outline && input.outline.length < 3) throw new Error("Board outline needs at least three vertices")
    for (const obstacle of input.obstacles) {
      if (![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height].every(Number.isFinite) ||
        obstacle.width < 0 || obstacle.height < 0) throw new Error("Invalid test point obstacle geometry")
    }
    for (const trace of input.traces ?? []) {
      if (trace.route.some((p) => p.route_type !== "wire" && p.route_type !== "via")) {
        throw new Error("Test point phase requires explicit wire/via copper geometry")
      }
    }
    this.output = { ...structuredClone(input), testPoints: [] }
    this.MAX_ITERATIONS = options.requests.length + 1
  }

  /** Conservative swept-circle clearance check against all input copper and obstacles. */
  private isClear(a: Point, b: Point, radius: number, layer: string,
    trace: SimplifiedPcbTrace, checkProbeSpacing: boolean): boolean {
    const clearance = Math.max(this.options.clearance,
      this.input.minTraceToPadEdgeClearance ?? 0, this.input.minPadEdgeToPadEdgeClearance ?? 0,
      this.input.minViaEdgeToPadEdgeClearance ?? 0, this.input.minTraceToHoleEdgeClearance ?? 0)
    const margin = radius + Math.max(clearance, this.input.minBoardEdgeClearance ?? 0)
    const bounds = this.input.bounds
    for (const p of [a, b]) {
      if (p.x < bounds.minX + margin || p.x > bounds.maxX - margin ||
          p.y < bounds.minY + margin || p.y > bounds.maxY - margin) return false
    }
    if (this.input.outline) {
      const polygon = this.input.outline
      for (const p of [a, b]) {
        let inside = false
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const u = polygon[i]!, v = polygon[j]!
          if ((u.y > p.y) !== (v.y > p.y) && p.x < (v.x - u.x) * (p.y - u.y) / (v.y - u.y) + u.x) inside = !inside
        }
        if (!inside) return false
      }
      for (let i = 0; i < polygon.length; i++) {
        if (segmentDistance(a, b, polygon[i]!, polygon[(i + 1) % polygon.length]!) < margin) return false
      }
    }
    for (const obstacle of this.output.obstacles) {
      if (!obstacle.layers.includes(layer)) continue
      // Circumscribed AABB for rotated rectangles is intentionally conservative.
      const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
      const halfX = (Math.abs(Math.cos(angle)) * obstacle.width + Math.abs(Math.sin(angle)) * obstacle.height) / 2
      const halfY = (Math.abs(Math.sin(angle)) * obstacle.width + Math.abs(Math.cos(angle)) * obstacle.height) / 2
      if (obstacle.shape === "circle") {
        if (pointSegmentDistance(obstacle.center, a, b) < radius + clearance + Math.max(halfX, halfY)) return false
        continue
      }
      const minX = obstacle.center.x - halfX, maxX = obstacle.center.x + halfX
      const minY = obstacle.center.y - halfY, maxY = obstacle.center.y + halfY
      if ([a, b].some((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)) return false
      const corners = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }]
      for (let i = 0; i < 4; i++) {
        if (segmentDistance(a, b, corners[i]!, corners[(i + 1) % 4]!) < radius + clearance) return false
      }
    }
    for (const other of this.output.traces ?? []) {
      for (let i = 0; i < other.route.length; i++) {
        const p = other.route[i]!, q = other.route[i + 1]
        if (p.route_type === "via") {
          // Through-via barrel, including intermediate layers; no via-in-pad.
          if (pointSegmentDistance(p, a, b) < radius + clearance + (p.via_diameter ?? this.input.minViaPadDiameter ?? this.input.minViaDiameter ?? 0.6) / 2) return false
        }
        if (other.pcb_trace_id === trace.pcb_trace_id) continue
        if (!q || (p.route_type !== "wire" && p.route_type !== "via") ||
          (q.route_type !== "wire" && q.route_type !== "via")) continue
        const fromLayer = p.route_type === "wire" ? p.layer : p.to_layer
        const toLayer = q.route_type === "wire" ? q.layer : q.from_layer
        const width = Math.max(p.route_type === "wire" ? p.width : 0,
          q.route_type === "wire" ? q.width : 0, this.input.minTraceWidth)
        if (fromLayer === layer && toLayer === layer &&
          segmentDistance(a, b, p, q) < radius + clearance + width / 2) return false
      }
    }
    for (const pad of this.output.testPoints) {
      if (pad.layer !== layer) continue
      const distance = pointSegmentDistance(pad, a, b)
      if (distance < radius + pad.diameter / 2 + clearance ||
          (checkProbeSpacing && distance < this.options.minProbeSpacing)) return false
    }
    return true
  }

  override _step(): void {
    const request = this.options.requests[this.requestIndex]
    if (!request) { this.solved = true; return }
    const trace = this.output.traces!.find((t) => t.pcb_trace_id === request.pcbTraceId)!
    const step = this.options.sampleStep ?? 0.25
    const offsets = [0]
    for (let d = step; d <= this.options.maxDetour + 1e-9; d += step) offsets.push(d, -d)
    for (const offset of offsets) {
      for (let i = 0; i < trace.route.length - 1; i++) {
        const a = trace.route[i]!, b = trace.route[i + 1]!
        if (a.route_type !== "wire" || b.route_type !== "wire" ||
            a.layer !== request.layer || b.layer !== request.layer || a.width !== b.width) continue
        const length = Math.hypot(b.x - a.x, b.y - a.y)
        if (length < step * 2) continue
        const count = Math.ceil(length / step)
        // Center first, then evenly sampled interior positions; deterministic.
        const fractions = [0.5, ...Array.from({ length: count - 1 }, (_, j) => (j + 1) / count)]
        for (const t of fractions) {
          const p = { x: a.x + (b.x - a.x) * t - (b.y - a.y) / length * offset,
            y: a.y + (b.y - a.y) * t + (b.x - a.x) / length * offset }
          if (!this.isClear(p, p, request.diameter / 2, request.layer, trace, true)) continue
          // Check the entire changed segment, not just the landing pad.
          if (offset !== 0 && (!this.isClear(a, p, a.width / 2, request.layer, trace, false) ||
            !this.isClear(p, b, a.width / 2, request.layer, trace, false))) continue
          const wire: Wire = { route_type: "wire", ...p, width: a.width, layer: a.layer }
          trace.route.splice(i + 1, 0, wire)
          this.output.testPoints.push({ ...request, ...p, connectionName: trace.connection_name })
          this.requestIndex++
          return
        }
      }
    }
    throw new Error(`No clearance-safe test point placement for ${request.name}`)
  }

  override getConstructorParams(): [SimpleRouteJson, TestPointOptions] {
    return [this.input, this.options]
  }

  override getOutput(): TestPointOutput {
    if (!this.solved) throw new Error("Test point phase has not solved")
    const result = structuredClone(this.output)
    result.obstacles.push(...result.testPoints.map((pad) => ({
      type: "rect" as const, shape: "circle" as const, obstacleId: `test_point_${pad.name}`,
      center: { x: pad.x, y: pad.y }, width: pad.diameter, height: pad.diameter,
      layers: [pad.layer], connectedTo: [pad.connectionName],
    })))
    return result
  }

  override visualize(): GraphicsObject {
    const graphics = convertSrjToGraphicsObject(this.output)
    for (const pad of this.output.testPoints) {
      graphics.circles.push({ center: { x: pad.x, y: pad.y }, radius: pad.diameter / 2,
        fill: "#e6ac00", stroke: "#503600", label: pad.name,
        layer: pad.layer === "top" ? "z0" : `z${this.input.layerCount - 1}` })
    }
    return graphics
  }
}
