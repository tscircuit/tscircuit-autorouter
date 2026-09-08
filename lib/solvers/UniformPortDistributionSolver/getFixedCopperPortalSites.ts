import type { FixedCopperRectangle } from "lib/data-structures/FixedCopperClearanceIndex"
import { addWithDirectedRounding } from "lib/utils/addWithDirectedRounding"
import {
  type FixedCopperClearanceInterval,
  getFixedCopperClearanceIntervals,
} from "./getFixedCopperClearanceIntervals"

type Point = Readonly<{ x: number; y: number }>

export type FixedCopperPortalSitesInput = {
  readonly start: Point
  readonly end: Point
  readonly layerCount: number
  readonly zLayers: readonly number[]
  readonly traceWidth: number
  readonly traceGap: number
  readonly padGap: number
  readonly routableNetIds: ReadonlySet<string>
  readonly rectangles: readonly FixedCopperRectangle[]
}

export type FixedCopperPortalSite = {
  readonly index: number
  readonly x: number
  readonly y: number
}

export type FixedCopperPortalLayer = {
  readonly z: number
  /** Closed ABSOLUTE coordinates on the varying axis, not distance offsets. */
  readonly intervals: readonly Readonly<FixedCopperClearanceInterval>[]
  readonly sites: readonly FixedCopperPortalSite[]
  readonly capacity: number
}

export type FixedCopperPortalSites = {
  readonly start: Point
  readonly end: Point
  readonly axis: "x" | "y"
  readonly pitch: number
  readonly layers: readonly FixedCopperPortalLayer[]
  readonly totalCapacity: number
}

/**
 * Maximum earliest-first packing for common-width sites in the returned closed
 * interval model. Only copper foreign to EVERY supplied canonical route net
 * constrains this shared resource. Per-net obstacles/reservations remain the
 * caller's responsibility; these sites are not an every-net DRC certificate.
 *
 * Direction and layer order are canonical. Analytic distance intervals come
 * from the existing rectangle helper; translation rounds inward, and spacing
 * rounds upward. No sampled positions, corner margins or capacity cap are used.
 * This pure prototype does not create graph resources or change any pipeline.
 */
export const getFixedCopperPortalSites = (
  params: FixedCopperPortalSitesInput,
): FixedCopperPortalSites => {
  if (
    !Number.isSafeInteger(params.layerCount) ||
    params.layerCount <= 0 ||
    params.zLayers.length === 0 ||
    params.routableNetIds.size === 0 ||
    !Number.isFinite(params.traceWidth) ||
    params.traceWidth <= 0 ||
    !Number.isFinite(params.traceGap) ||
    params.traceGap < 0 ||
    !Number.isFinite(params.padGap) ||
    params.padGap < 0
  ) {
    throw new Error("getFixedCopperPortalSites has invalid physical inputs")
  }
  for (const netId of params.routableNetIds) {
    if (typeof netId !== "string" || netId.length === 0) {
      throw new Error("getFixedCopperPortalSites requires canonical route nets")
    }
  }
  const zLayers = [...new Set(params.zLayers)].sort(
    (left, right): number => left - right,
  )
  for (const z of zLayers) {
    if (!Number.isInteger(z) || z < 0 || z >= params.layerCount) {
      throw new Error("getFixedCopperPortalSites has an invalid cut layer")
    }
  }
  const startBeforeEnd =
    params.start.x < params.end.x ||
    (params.start.x === params.end.x && params.start.y <= params.end.y)
  const start = { ...(startBeforeEnd ? params.start : params.end) }
  const end = { ...(startBeforeEnd ? params.end : params.start) }
  const axis = start.x === end.x ? "y" : "x"
  const origin = start[axis]
  const length = end[axis] - origin
  const pitch = params.traceWidth + params.traceGap
  if (!Number.isFinite(pitch) || pitch <= 0) {
    throw new Error("getFixedCopperPortalSites cannot represent physical pitch")
  }

  // Validate ALL supplied copper through the existing domain boundary, even a
  // rectangle later omitted because one actual route net owns it. No virtual
  // net or invented ownership is used for this validation or the final query.
  const canonicalNetId = [...params.routableNetIds].sort()[0]!
  getFixedCopperClearanceIntervals({
    start,
    end,
    z: zLayers[0]!,
    layerCount: params.layerCount,
    canonicalNetId,
    copperDiameter: params.traceWidth,
    minClearance: params.padGap,
    rectangles: params.rectangles,
  })
  const rectangles = params.rectangles.filter(
    (rectangle): boolean =>
      ![...rectangle.ownerNetIds].some((netId): boolean =>
        params.routableNetIds.has(netId),
      ),
  )

  const layers: FixedCopperPortalLayer[] = []
  let totalCapacity = 0
  for (const z of zLayers) {
    const distanceIntervals = getFixedCopperClearanceIntervals({
      start,
      end,
      z,
      layerCount: params.layerCount,
      canonicalNetId,
      copperDiameter: params.traceWidth,
      minClearance: params.padGap,
      rectangles,
    })
    const intervals: FixedCopperClearanceInterval[] = []
    for (const interval of distanceIntervals) {
      const absoluteStart =
        interval.start === 0
          ? origin
          : Math.max(
              origin,
              addWithDirectedRounding(origin, interval.start, "up"),
            )
      const absoluteEnd =
        interval.end === length
          ? end[axis]
          : Math.min(
              end[axis],
              addWithDirectedRounding(origin, interval.end, "down"),
            )
      // An exact translated interval may contain no representable coordinate.
      if (absoluteStart <= absoluteEnd) {
        intervals.push({ start: absoluteStart, end: absoluteEnd })
      }
    }
    const sites: FixedCopperPortalSite[] = []
    let nextCoordinate: number | undefined
    for (const interval of intervals) {
      let coordinate = Math.max(interval.start, nextCoordinate ?? interval.start)
      while (coordinate <= interval.end) {
        sites.push({
          index: sites.length,
          x: axis === "x" ? coordinate : start.x,
          y: axis === "y" ? coordinate : start.y,
        })
        if (coordinate === end[axis] || coordinate + pitch > end[axis]) {
          nextCoordinate = Number.POSITIVE_INFINITY
          break
        }
        nextCoordinate = addWithDirectedRounding(coordinate, pitch, "up")
        if (nextCoordinate <= coordinate) {
          throw new Error("getFixedCopperPortalSites cannot advance a site")
        }
        coordinate = nextCoordinate
      }
    }
    totalCapacity += sites.length
    if (!Number.isSafeInteger(totalCapacity)) {
      throw new Error("getFixedCopperPortalSites cannot represent total capacity")
    }
    layers.push({ z, intervals, sites, capacity: sites.length })
  }
  return { start, end, axis, pitch, layers, totalCapacity }
}
