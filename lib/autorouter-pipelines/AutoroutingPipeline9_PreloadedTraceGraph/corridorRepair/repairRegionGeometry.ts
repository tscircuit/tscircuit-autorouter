import type { Bounds, RepairRoutePoint } from "./repairRegionTypes"
import type { HighDensityRoute } from "./repairTypes"

export const REGION_EPSILON = 1e-8

export const isPointInBounds = (
  point: { x: number; y: number },
  bounds: Bounds,
  inset = 0,
): boolean => {
  return (
    point.x >= bounds.minX + inset - REGION_EPSILON &&
    point.x <= bounds.maxX - inset + REGION_EPSILON &&
    point.y >= bounds.minY + inset - REGION_EPSILON &&
    point.y <= bounds.maxY - inset + REGION_EPSILON
  )
}

export const getSegmentBoundsInterval = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  bounds: Bounds,
): [number, number] | undefined => {
  let minT = 0
  let maxT = 1
  for (const [origin, delta, min, max] of [
    [start.x, end.x - start.x, bounds.minX, bounds.maxX],
    [start.y, end.y - start.y, bounds.minY, bounds.maxY],
  ]) {
    if (
      origin === undefined ||
      delta === undefined ||
      min === undefined ||
      max === undefined
    ) {
      throw new Error("Invalid segment clipping axis")
    }
    if (Math.abs(delta) <= REGION_EPSILON) {
      if (origin < min - REGION_EPSILON || origin > max + REGION_EPSILON)
        return undefined
      continue
    }
    const first = (min - origin) / delta
    const second = (max - origin) / delta
    minT = Math.max(minT, Math.min(first, second))
    maxT = Math.min(maxT, Math.max(first, second))
    if (maxT < minT - REGION_EPSILON) return undefined
  }
  return [Math.max(0, minT), Math.min(1, maxT)]
}

export const interpolateRepairPoint = (
  start: RepairRoutePoint,
  end: RepairRoutePoint,
  t: number,
): RepairRoutePoint => {
  if (t <= REGION_EPSILON) return structuredClone(start)
  if (t >= 1 - REGION_EPSILON) return structuredClone(end)
  // Segment metadata belongs to its departure point, but terminal identity
  // belongs only to the actual, original point.
  const point = {
    ...structuredClone(start),
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  }
  delete point.pcb_port_id
  return point
}

export const sameRepairPoint = (
  left: { x: number; y: number; z?: number },
  right: { x: number; y: number; z?: number },
): boolean => {
  return (
    Math.abs(left.x - right.x) <= REGION_EPSILON &&
    Math.abs(left.y - right.y) <= REGION_EPSILON &&
    left.z === right.z
  )
}

/** Compare metadata independent of key order and omitted undefined object fields. */
export const repairValueKey = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(repairValueKey).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${repairValueKey((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "undefined"
}

export const getRepairSourceSpan = (
  route: HighDensityRoute,
  from: number,
  to: number,
): RepairRoutePoint[] => {
  if (route.route.length === 1) return structuredClone(route.route)
  const pointAt = (position: number): RepairRoutePoint => {
    const index = Math.min(Math.floor(position), route.route.length - 2)
    return interpolateRepairPoint(
      route.route[index]!,
      route.route[index + 1]!,
      position - index,
    )
  }
  const points = [pointAt(from)]
  for (
    let index = Math.floor(from) + 1;
    index < to - REGION_EPSILON;
    index += 1
  )
    points.push(structuredClone(route.route[index]!))
  if (to > from + REGION_EPSILON) points.push(pointAt(to))
  return points
}

/** Bind a proposed edit to the same electrical identity and copper geometry. */
export const getRepairSourceStateKey = (
  route: HighDensityRoute,
  from: number,
  to: number,
): string => {
  const points = getRepairSourceSpan(route, from, to)
  const metadata = Object.fromEntries(
    Object.entries(route).filter(([key]) => key !== "route" && key !== "vias"),
  )
  const vias = route.vias.filter((via) =>
    points.some(
      (point) => Math.hypot(point.x - via.x, point.y - via.y) <= REGION_EPSILON,
    ),
  )
  return repairValueKey({ metadata, points, vias })
}
