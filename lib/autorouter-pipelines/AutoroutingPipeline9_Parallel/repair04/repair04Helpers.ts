/**
 * Copied from @tscircuit/repair04 at
 * 81d4585d335ea1958a1c6569e4064c58cba44bad (MIT, see ./LICENSE).
 * These private helpers are not exposed by that package's exports map.
 */
import type { Bounds, ClearancePathInput } from "@tscircuit/repair04"
import type { HighDensityRoute } from "high-density-repair03/lib"
export type { Bounds } from "@tscircuit/repair04"
type SimpleRouteJson = ClearancePathInput["srj"]

export type RepairRoutePoint = HighDensityRoute["route"][number] & {
  traceThickness?: number
  toNextSegmentCircuitJsonMetadata?: Record<string, unknown>
}
export const REGION_EPSILON = 1e-8


/** Trace layers are electrical; a default drilled via occupies the whole board. */
export function getRepairCopperLayerSpan(
  srj: Pick<SimpleRouteJson, "layerCount"> & {
    allowBlindAndBuriedVias?: boolean
  },
  a: { z: number },
  b: { z: number },
): { minZ: number; maxZ: number } {
  const throughHole = a.z !== b.z && srj.allowBlindAndBuriedVias !== true
  return {
    minZ: throughHole ? 0 : Math.min(a.z, b.z),
    maxZ: throughHole ? srj.layerCount - 1 : Math.max(a.z, b.z),
  }
}


/** Electrical clearance does not add a manufacturing gap to connected pads. */
export function getViaPadClearance(
  srj: Pick<
    SimpleRouteJson,
    "defaultObstacleMargin" | "minViaEdgeToPadEdgeClearance"
  >,
  viaClearance: number,
  sameNet: boolean,
): number {
  // Preserve explicitly declared obstacle/pad margins even on connected pads.
  // Without one, their annuli must stay outside copper, but need no extra gap.
  return Math.max(
    sameNet ? 0 : viaClearance,
    srj.defaultObstacleMargin ?? 0,
    srj.minViaEdgeToPadEdgeClearance ?? 0,
  )
}


type Point = { x: number; y: number }

/** Tighten only inside the previous enclosure, with outward rounding slack. */
export const getConservativeRectBarrierBounds = (
  a: Point,
  b: Point,
  rect: { width: number; height: number; rotation: number },
  cosine: number,
  sine: number,
  original: Bounds,
): Bounds => {
  if (
    a.x !== b.x ||
    a.y !== b.y ||
    !Number.isFinite(rect.rotation) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    ![
      a.x,
      a.y,
      rect.width,
      rect.height,
      original.minX,
      original.maxX,
      original.minY,
      original.maxY,
    ].every((value) => Number.isFinite(value) && Math.abs(value) <= 10_000)
  )
    return original

  // The exact checker transforms world coordinates with these same computed
  // cosine/sine values. Divide by their determinant to enclose the inverse
  // transform, rather than assuming floating-point cos² + sin² is exactly 1.
  const determinant = cosine * cosine + sine * sine
  if (!Number.isFinite(determinant) || Math.abs(determinant - 1) > 1e-12)
    return original
  const outwardMargin = 1e-8
  const halfWidth = rect.width / 2,
    halfHeight = rect.height / 2
  const extentX =
    (Math.abs(cosine) * halfWidth + Math.abs(sine) * halfHeight) / determinant +
    outwardMargin
  const extentY =
    (Math.abs(sine) * halfWidth + Math.abs(cosine) * halfHeight) / determinant +
    outwardMargin
  const bounds = {
    minX: a.x - extentX,
    maxX: a.x + extentX,
    minY: a.y - extentY,
    maxY: a.y + extentY,
  }
  // Never enlarge the original query domain. Degenerate/equal-boundary cases
  // retain the original bounds and exact checker behavior.
  if (
    bounds.minX < original.minX ||
    bounds.maxX > original.maxX ||
    bounds.minY < original.minY ||
    bounds.maxY > original.maxY
  )
    return original
  return bounds
}

export const getNetRepresentatives = (
  srj: Pick<SimpleRouteJson, "connections" | "obstacles">,
  routes: readonly HighDensityRoute[],
): Map<string, string> => {
  const parents = new Map<string, string>()
  const find = (name: string): string => {
    const parent = parents.get(name)
    if (parent === undefined) {
      parents.set(name, name)
      return name
    }
    if (parent === name) return name
    const root = find(parent)
    parents.set(name, root)
    return root
  }
  const union = (names: Array<string | undefined>): void => {
    const present = names.filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    )
    if (present.length === 0) return
    const root = find(present[0]!)
    for (const name of present) parents.set(find(name), root)
  }
  for (const original of srj.connections) {
    const connection = original as typeof original & {
      __rootConnectionNames?: string[]
      __netConnectionName?: string
    }
    union([
      connection.name,
      connection.rootConnectionName,
      connection.netConnectionName,
      connection.__netConnectionName,
      ...(connection.mergedConnectionNames ?? []),
      ...(connection.__rootConnectionNames ?? []),
      ...connection.pointsToConnect.flatMap((point) => [
        point.pointId,
        point.pcb_port_id,
      ]),
    ])
  }
  for (const obstacle of srj.obstacles) union(obstacle.connectedTo)
  for (const route of routes)
    union([route.connectionName, route.rootConnectionName])
  for (const name of parents.keys()) parents.set(name, find(name))
  return parents
}



/** Strict separation only; retain exact geometry checks near the boundary. */
export function areExpandedBoundsSeparated(
  a: Bounds,
  b: Bounds,
  reach: number,
): boolean {
  return (
    a.minX - reach - REGION_EPSILON > b.maxX ||
    a.maxX + reach + REGION_EPSILON < b.minX ||
    a.minY - reach - REGION_EPSILON > b.maxY ||
    a.maxY + reach + REGION_EPSILON < b.minY
  )
}

// Native Math.hypot can round differently between platforms.
// Scaling avoids overflow and underflow when squaring the coordinates.
export const getVectorLength = (x: number, y: number): number => {
  const scale = Math.max(Math.abs(x), Math.abs(y))
  if (scale === 0 || scale === Number.POSITIVE_INFINITY) return scale
  const scaledX = x / scale
  const scaledY = y / scale
  return scale * Math.sqrt(scaledX * scaledX + scaledY * scaledY)
}

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


export type RepairRegionInput = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  bounds: Bounds
  boundaryMargin: number
  lockedPointIndices: boolean[][]
}

