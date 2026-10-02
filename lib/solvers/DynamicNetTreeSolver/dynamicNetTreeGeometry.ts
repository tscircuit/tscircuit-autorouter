import { minimumDistanceBetweenSegments } from "../../utils/minimumDistanceBetweenSegments"

export type TreePoint = { x: number; y: number }
export type TreeCopper = {
  id: string
  owner: string
  layers: number[]
  start: TreePoint
  end: TreePoint
  radius: number
  kind: "wire" | "via" | "pad" | "terminal" | "hole"
  sourcePadId?: string
  /** Conservative input pad envelope retained for candidate routing. */
  routingEnvelope?: { width: number; height: number; rotation: number }
  rectangle?: { width: number; height: number; rotation: number }
  holeDiameter?: number
  /** Drill geometry is independent of an oval/rounded copper land. */
  drill?: {
    start: TreePoint
    end: TreePoint
    diameter: number
    layers: number[]
  }
}

export function projectToCopper(
  point: TreePoint,
  copper: TreeCopper,
): TreePoint {
  if (copper.rectangle) {
    const { width, height, rotation } = copper.rectangle
    const c = Math.cos(rotation),
      s = Math.sin(rotation)
    const dx = point.x - copper.start.x,
      dy = point.y - copper.start.y
    const x = Math.max(-width / 2, Math.min(width / 2, c * dx + s * dy))
    const y = Math.max(-height / 2, Math.min(height / 2, -s * dx + c * dy))
    const core = {
      x: copper.start.x + c * x - s * y,
      y: copper.start.y + s * x + c * y,
    }
    const gap = Math.hypot(point.x - core.x, point.y - core.y)
    if (gap <= copper.radius) return { ...point }
    return {
      x: core.x + ((point.x - core.x) * copper.radius) / gap,
      y: core.y + ((point.y - core.y) * copper.radius) / gap,
    }
  }
  const dx = copper.end.x - copper.start.x,
    dy = copper.end.y - copper.start.y
  const denominator = dx * dx + dy * dy
  const t =
    denominator === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - copper.start.x) * dx +
              (point.y - copper.start.y) * dy) /
              denominator,
          ),
        )
  // Use the centerline for wires/vias, so attachment is auditable and not a
  // near-touch exemption. Rectangular pad land is itself existing copper.
  return { x: copper.start.x + t * dx, y: copper.start.y + t * dy }
}

export function copperRectangleCorners(copper: TreeCopper): TreePoint[] {
  if (!copper.rectangle)
    throw new Error(`Copper ${copper.id} is not rectangular`)
  const { width, height, rotation } = copper.rectangle
  const c = Math.cos(rotation),
    s = Math.sin(rotation)
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => ({
    x: copper.start.x + (c * sx! * width) / 2 - (s * sy! * height) / 2,
    y: copper.start.y + (s * sx! * width) / 2 + (c * sy! * height) / 2,
  }))
}

export function segmentCopperGap(
  a: TreePoint,
  b: TreePoint,
  copper: TreeCopper,
): number {
  if (!copper.rectangle)
    return (
      minimumDistanceBetweenSegments(a, b, copper.start, copper.end) -
      copper.radius
    )
  const core = { ...copper, radius: 0 }
  const pa = projectToCopper(a, core),
    pb = projectToCopper(b, core)
  if (
    Math.hypot(a.x - pa.x, a.y - pa.y) < 1e-10 ||
    Math.hypot(b.x - pb.x, b.y - pb.y) < 1e-10
  )
    return -copper.radius
  const corners = copperRectangleCorners(copper)
  return (
    Math.min(
      ...corners.map((p, i) =>
        minimumDistanceBetweenSegments(a, b, p, corners[(i + 1) % 4]!),
      ),
    ) - copper.radius
  )
}

/** Symmetric continuous shape gap, including either containment order. Rounded
 * rectangles are a rectangular core plus their exact corner radius. */
export function copperGap(a: TreeCopper, b: TreeCopper): number {
  if (!a.rectangle) return segmentCopperGap(a.start, a.end, b) - a.radius
  const corners = copperRectangleCorners(a)
  return Math.min(
    segmentCopperGap(b.start, b.end, a) - b.radius,
    ...corners.map(
      (p, i) => segmentCopperGap(p, corners[(i + 1) % 4]!, b) - a.radius,
    ),
  )
}

export function copperTouches(a: TreeCopper, b: TreeCopper): boolean {
  if (a.kind === "hole" || b.kind === "hole") return false
  if (!a.layers.some((z) => b.layers.includes(z))) return false
  return copperGap(a, b) <= 1e-8
}

export function pointInOutline(
  point: TreePoint,
  outline: TreePoint[],
): boolean {
  let inside = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!,
      b = outline[j]!
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside
  }
  return inside
}
