import type {
  FixedCopperClearanceIndex,
  FixedCopperRectangle,
  PhysicalCopperPoint,
} from "lib/data-structures/FixedCopperClearanceIndex"
import { addWithDirectedRounding } from "lib/utils/addWithDirectedRounding"
import {
  type FixedCopperClearanceInterval,
  getFixedCopperClearanceIntervals,
} from "../UniformPortDistributionSolver/getFixedCopperClearanceIntervals"

type Point = Readonly<{ x: number; y: number }>
type Interval = Readonly<FixedCopperClearanceInterval>
type ScheduledSite = {
  readonly intervalIndex: number
  readonly earliest: number
  latest: number
}

type RepresentedEmptyInterval = {
  readonly intervalIndex: number
  readonly interval: Interval
  readonly point: PhysicalCopperPoint
  readonly reason: "index-blocked-singleton"
}

export type NetAwareCrampedPortSitesInput = {
  readonly start: Point
  readonly end: Point
  /** Existing shared site, blocked for every actual routed net. */
  readonly existingPoint: PhysicalCopperPoint
  readonly layerCount: number
  readonly traceWidth: number
  readonly traceGap: number
  readonly padGap: number
  readonly routableNetIds: ReadonlySet<string>
  /**
   * Complete fixed geometry, or an edge/layer candidate subset prepared by the
   * caller from the same AABBs as the whole-board index. The expanded edge query
   * must contain every point-query box on this edge; excluded copper is then
   * predicate-irrelevant here. Subsets must never be chosen by ownership alone.
   */
  readonly rectangles: readonly FixedCopperRectangle[]
  /** Whole-board predicate with matching source geometry, layers and pad gap. */
  readonly clearanceIndex: FixedCopperClearanceIndex
}

export type NetAwareCrampedPortIntervalClass = {
  readonly netIds: readonly string[]
  /** Closed distance intervals from the canonical edge start. */
  readonly distanceIntervals: readonly Interval[]
  /** Inward-rounded absolute coordinates on the varying axis. */
  readonly intervals: readonly Interval[]
}

export type NetAwareCrampedPortSite = PhysicalCopperPoint & {
  readonly index: number
  /** Actual routed nets admitted by the supplied point index. Never virtual. */
  readonly allowedNetIds: readonly string[]
}

type SiteEvidence = {
  readonly start: Point
  readonly end: Point
  readonly axis: "x" | "y"
  readonly z: number
  readonly pitch: number
  readonly netClasses: readonly NetAwareCrampedPortIntervalClass[]
  /** Union of the closed, inward-translated analytic interval model. */
  readonly intervals: readonly Interval[]
  /** Singleton components with no represented site for the actual route nets. */
  readonly representedEmptyIntervals: readonly RepresentedEmptyInterval[]
}

export type NetAwareCrampedPortSites = SiteEvidence &
  (
    | {
        readonly status: "complete"
        readonly sites: readonly NetAwareCrampedPortSite[]
        readonly capacity: number
      }
    | {
        readonly status: "unresolved-index-boundary"
        readonly reason:
          | "packed-site-blocked-by-index"
          | "analytic-interval-has-no-representable-coordinate"
        readonly attemptedSite: PhysicalCopperPoint | null
        readonly intervalClassIndex: number | null
        readonly distanceInterval: Interval | null
      }
  )

/**
 * One globally centered, common-pitch packing of the union of actual-net legal
 * intervals on ONE blocked shared edge/layer. Earliest-first fixes the count
 * and component assignments; latest feasible bounds then provide midpoint
 * targets for one directed forward placement. It is not per-net or per-channel
 * centering: every output site consumes spacing in the same ordered list.
 *
 * The caller owns eligibility (including unchanged terminals/preloads), the
 * prepared-index contract, and graph resource identity. Available uses this
 * only for all-net-blocked cramped midpoint layers in Pipeline9's generated-
 * copper input domain. It does not certify cross-edge capacity, net coverage,
 * whole-node routability, or maximum capacity under the index's floating-point
 * predicate. Nearby ownership signatures avoid one geometry query per net.
 *
 * A represented singleton rejected by the index is explicitly empty: there
 * is no other coordinate in that component. Positive-width channels are not
 * discarded on this reasoning. Analytic roots and the actual point predicate
 * may still disagree, and maximum count can force endpoints. A rejected final
 * site returns all interval evidence but NO usable sites, without retrying
 * another placement. Available reports that evidence in a named edge/layer
 * error; it never publishes a partial list or retries the legacy midpoint.
 */
export const getNetAwareCrampedPortSites = (
  params: NetAwareCrampedPortSitesInput,
): NetAwareCrampedPortSites => {
  assertCrampedSiteInputs(params)
  const startBeforeEnd =
    params.start.x < params.end.x ||
    (params.start.x === params.end.x && params.start.y < params.end.y)
  const start = { ...(startBeforeEnd ? params.start : params.end) }
  const end = { ...(startBeforeEnd ? params.end : params.start) }
  const axis = start.x === end.x ? "y" : "x"
  const z = params.existingPoint.z
  const origin = start[axis]
  const length = end[axis] - origin
  const pitch = addWithDirectedRounding(
    params.traceWidth,
    params.traceGap,
    "up",
  )
  const netIds = [...params.routableNetIds].sort()
  const intervalParams = {
    start,
    end,
    z,
    layerCount: params.layerCount,
    copperDiameter: params.traceWidth,
    minClearance: params.padGap,
  }

  // Validate every supplied rectangle, even distant or owned geometry. This
  // query also supplies the first class's model without a repeated query.
  const firstIntervals = getFixedCopperClearanceIntervals({
    ...intervalParams,
    canonicalNetId: netIds[0]!,
    rectangles: params.rectangles,
  })
  const existingOwners = getActualAllowedNetIds(
    params,
    params.existingPoint,
    netIds,
  )
  if (existingOwners.length !== 0) {
    throw new Error(
      "getNetAwareCrampedPortSites requires an all-net-blocked existing site",
    )
  }
  const nearbyRectangles = getNearbyRectangles(params, start, end)
  const classes = getNearbyOwnerClasses(nearbyRectangles, netIds)
  const netClasses: NetAwareCrampedPortIntervalClass[] = []
  let unrepresentable:
    | { intervalClassIndex: number; distanceInterval: Interval }
    | undefined
  for (const classNetIds of classes) {
    const distanceIntervals =
      classNetIds[0] === netIds[0]
        ? firstIntervals
        : getFixedCopperClearanceIntervals({
            ...intervalParams,
            canonicalNetId: classNetIds[0]!,
            rectangles: nearbyRectangles,
          })
    const intervals: Interval[] = []
    for (const interval of distanceIntervals) {
      const absoluteStart =
        interval.start === 0
          ? origin
          : addWithDirectedRounding(origin, interval.start, "up")
      const absoluteEnd =
        interval.end === length
          ? end[axis]
          : addWithDirectedRounding(origin, interval.end, "down")
      if (absoluteStart > absoluteEnd) {
        if (unrepresentable === undefined) {
          unrepresentable = {
            intervalClassIndex: netClasses.length,
            distanceInterval: { ...interval },
          }
        }
      } else {
        intervals.push({ start: absoluteStart, end: absoluteEnd })
      }
    }
    netClasses.push({
      netIds: classNetIds,
      distanceIntervals,
      intervals,
    })
  }
  const intervals = mergeIntervalClasses(netClasses)
  const representedEmptyIntervals: RepresentedEmptyInterval[] = []
  const evidence: SiteEvidence = {
    start,
    end,
    axis,
    z,
    pitch,
    netClasses,
    intervals,
    representedEmptyIntervals,
  }
  if (unrepresentable !== undefined) {
    return {
      ...evidence,
      status: "unresolved-index-boundary",
      reason: "analytic-interval-has-no-representable-coordinate",
      attemptedSite: null,
      ...unrepresentable,
    }
  }

  // A singleton has exactly one represented coordinate. Its direct query can
  // establish an empty component, unlike a rejected point in a wider channel.
  const emptyIntervalIndexes = new Set<number>()
  for (const [intervalIndex, interval] of intervals.entries()) {
    if (interval.start !== interval.end) continue
    const point = {
      x: axis === "x" ? interval.start : start.x,
      y: axis === "y" ? interval.start : start.y,
      z,
    }
    if (getActualAllowedNetIds(params, point, netIds).length !== 0) continue
    emptyIntervalIndexes.add(intervalIndex)
    representedEmptyIntervals.push({
      intervalIndex,
      interval: { ...interval },
      point,
      reason: "index-blocked-singleton",
    })
  }

  const schedule: ScheduledSite[] = []
  let nextCoordinate: number | undefined
  for (const [intervalIndex, interval] of intervals.entries()) {
    if (emptyIntervalIndexes.has(intervalIndex)) continue
    let coordinate = Math.max(
      interval.start,
      nextCoordinate ?? interval.start,
    )
    while (coordinate <= interval.end) {
      schedule.push({
        intervalIndex,
        earliest: coordinate,
        latest: interval.end,
      })
      if (!Number.isSafeInteger(schedule.length)) {
        throw new Error("getNetAwareCrampedPortSites cannot represent capacity")
      }
      if (coordinate === end[axis] || coordinate + pitch > end[axis]) {
        nextCoordinate = Number.POSITIVE_INFINITY
        break
      }
      nextCoordinate = addWithDirectedRounding(coordinate, pitch, "up")
      if (nextCoordinate <= coordinate) {
        throw new Error("getNetAwareCrampedPortSites cannot advance a site")
      }
      coordinate = nextCoordinate
    }
  }

  for (let index = schedule.length - 1; index >= 0; index--) {
    const site = schedule[index]!
    const followingSite = schedule[index + 1]
    if (followingSite !== undefined) {
      site.latest = Math.min(
        site.latest,
        addWithDirectedRounding(followingSite.latest, -pitch, "down"),
      )
    }
    if (site.latest < site.earliest) {
      throw new Error(
        "getNetAwareCrampedPortSites cannot represent its fixed-count schedule",
      )
    }
  }

  // In exact arithmetic the average of the earliest/latest schedules is
  // feasible. Directed forward bounds preserve spacing after binary64 rounding.
  // This is the sole emitted placement, not a retry after checking endpoints.
  const sites: NetAwareCrampedPortSite[] = []
  let previousCoordinate: number | undefined
  for (const site of schedule) {
    const interval = intervals[site.intervalIndex]!
    const target = site.earliest + (site.latest - site.earliest) / 2
    const lowerBound =
      previousCoordinate === undefined
        ? interval.start
        : Math.max(
            interval.start,
            addWithDirectedRounding(previousCoordinate, pitch, "up"),
          )
    if (lowerBound > site.latest) {
      throw new Error(
        "getNetAwareCrampedPortSites cannot represent centered spacing",
      )
    }
    const coordinate = Math.max(lowerBound, Math.min(target, site.latest))
    const point = {
      x: axis === "x" ? coordinate : start.x,
      y: axis === "y" ? coordinate : start.y,
      z,
    }
    const allowedNetIds = getActualAllowedNetIds(params, point, netIds)
    if (allowedNetIds.length === 0) {
      return {
        ...evidence,
        status: "unresolved-index-boundary",
        reason: "packed-site-blocked-by-index",
        attemptedSite: point,
        intervalClassIndex: null,
        distanceInterval: null,
      }
    }
    sites.push({ ...point, index: sites.length, allowedNetIds })
    previousCoordinate = coordinate
  }
  return { ...evidence, status: "complete", sites, capacity: sites.length }
}

const assertCrampedSiteInputs = (
  params: NetAwareCrampedPortSitesInput,
): void => {
  const { start, end, existingPoint } = params
  if (
    !Number.isSafeInteger(params.layerCount) ||
    params.layerCount <= 0 ||
    !Number.isInteger(existingPoint.z) ||
    existingPoint.z < 0 ||
    existingPoint.z >= params.layerCount ||
    !Number.isFinite(params.traceWidth) ||
    params.traceWidth / 2 <= 0 ||
    !Number.isFinite(params.traceGap) ||
    params.traceGap < 0 ||
    !Number.isFinite(params.padGap) ||
    params.padGap < 0 ||
    !Number.isFinite(params.traceWidth + params.traceGap) ||
    params.routableNetIds.size === 0
  ) {
    throw new Error("getNetAwareCrampedPortSites has invalid physical inputs")
  }
  for (const point of [start, end, existingPoint]) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error("getNetAwareCrampedPortSites requires finite coordinates")
    }
  }
  if (
    (start.x !== end.x && start.y !== end.y) ||
    (start.x === end.x && start.y === end.y) ||
    (start.x === end.x && existingPoint.x !== start.x) ||
    (start.y === end.y && existingPoint.y !== start.y) ||
    existingPoint.x < Math.min(start.x, end.x) ||
    existingPoint.x > Math.max(start.x, end.x) ||
    existingPoint.y < Math.min(start.y, end.y) ||
    existingPoint.y > Math.max(start.y, end.y)
  ) {
    throw new Error("getNetAwareCrampedPortSites requires a shared axis edge")
  }
  for (const netId of params.routableNetIds) {
    if (typeof netId !== "string" || netId.length === 0) {
      throw new Error("getNetAwareCrampedPortSites requires canonical route nets")
    }
  }
}

const getNearbyRectangles = (
  params: NetAwareCrampedPortSitesInput,
  start: Point,
  end: Point,
): FixedCopperRectangle[] => {
  const margin = params.traceWidth / 2 + params.padGap
  const rectangles: FixedCopperRectangle[] = []
  for (const rectangle of params.rectangles) {
    if (!rectangle.zLayers.includes(params.existingPoint.z)) continue
    // Deliberately loose rotation-independent bounds; this is only a spatial
    // prefilter, never a clearance predicate. Overflow retains the rectangle.
    const reach = rectangle.width + rectangle.height + margin
    if (
      rectangle.center.x + reach < start.x ||
      rectangle.center.x - reach > end.x ||
      rectangle.center.y + reach < start.y ||
      rectangle.center.y - reach > end.y
    ) {
      continue
    }
    rectangles.push(rectangle)
  }
  return rectangles
}

const getNearbyOwnerClasses = (
  rectangles: readonly FixedCopperRectangle[],
  netIds: readonly string[],
): string[][] => {
  const ownedRectangleIds = new Map<string, number[]>()
  for (const netId of netIds) ownedRectangleIds.set(netId, [])
  for (const [index, rectangle] of rectangles.entries()) {
    for (const netId of rectangle.ownerNetIds) {
      ownedRectangleIds.get(netId)?.push(index)
    }
  }
  const classes = new Map<string, string[]>()
  for (const netId of netIds) {
    const signature = JSON.stringify(ownedRectangleIds.get(netId)!)
    const members = classes.get(signature)
    if (members === undefined) classes.set(signature, [netId])
    else members.push(netId)
  }
  return [...classes.values()]
}

const mergeIntervalClasses = (
  netClasses: readonly NetAwareCrampedPortIntervalClass[],
): Interval[] => {
  const sorted: FixedCopperClearanceInterval[] = []
  for (const netClass of netClasses) {
    for (const interval of netClass.intervals) sorted.push({ ...interval })
  }
  sorted.sort(
    (left, right): number => left.start - right.start || left.end - right.end,
  )
  const merged: FixedCopperClearanceInterval[] = []
  for (const interval of sorted) {
    const previous = merged.at(-1)
    if (previous === undefined || interval.start > previous.end) {
      merged.push(interval)
    } else {
      previous.end = Math.max(previous.end, interval.end)
    }
  }
  return merged
}

const getActualAllowedNetIds = (
  params: NetAwareCrampedPortSitesInput,
  point: PhysicalCopperPoint,
  netIds: readonly string[],
): string[] => {
  const allowed = params.clearanceIndex.getAllowedNetIdsAtPoint({
    point,
    copperDiameter: params.traceWidth,
  })
  if (allowed === null) return [...netIds]
  const actualNetIds: string[] = []
  for (const netId of netIds) {
    if (allowed.has(netId)) actualNetIds.push(netId)
  }
  return actualNetIds
}
