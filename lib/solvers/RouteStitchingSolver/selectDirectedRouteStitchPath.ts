import { distance, type Point3 } from "@tscircuit/math-utils"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getRouteStitchEndpoint } from "./getRouteStitchEndpoint"
import {
  getRouteStitchOrientation,
  type RouteStitchOrientation,
} from "./getRouteStitchOrientation"
import type { StitchTerminal } from "./getStitchTerminal"
import type { IsStitchSegmentClear } from "./route-stitch-clearance-validator"
import type { OrderedRouteStitchEntry } from "./routeStitchingEndpointHelpers"
import {
  compareRoutes,
  GEOMETRIC_STITCH_TOLERANCE,
  MAX_STITCH_GAP_DISTANCE_3,
  MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
} from "./routeStitchingShared"

type DirectedFragment = OrderedRouteStitchEntry & {
  start: StitchTerminal
  end: StitchTerminal
}
type PathCost = { gapCount: number; routeCount: number }
type SearchState = {
  fragmentIndex: number
  traceThickness: number
  orientationAnchorIndex: number
  cost: PathCost
  previousKey: string | null
}

const comparePathCosts = (first: PathCost, second: PathCost): number => {
  if (first.gapCount !== second.gapCount) {
    return first.gapCount - second.gapCount
  }
  return first.routeCount - second.routeCount
}

/**
 * Search states mean that a complete directed physical fragment was consumed.
 * Each edge is the actual next exit-to-entry join, not a chain of hypothetical
 * gap waypoints that the single-route stitcher cannot reproduce.
 */
export const selectDirectedRouteStitchPath = (params: {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: StitchTerminal
  end: StitchTerminal
  isStitchSegmentClear: IsStitchSegmentClear
}): OrderedRouteStitchEntry[] | null => {
  const fragments = [...params.hdRoutes].sort(compareRoutes).flatMap(
    (route): DirectedFragment[] => {
      const first = getRouteStitchEndpoint(route, "first")
      const last = getRouteStitchEndpoint(route, "last")
      return [
        { route, matchedOn: "first", start: first, end: last },
        { route, matchedOn: "last", start: last, end: first },
      ]
    },
  )
  const gapCosts = new Map<string, number | null>()
  const routeIndexes = new Map<HighDensityIntraNodeRoute, number>()
  const routeOrientations = new Map<
    HighDensityIntraNodeRoute,
    RouteStitchOrientation
  >()
  for (const [index, fragment] of fragments.entries()) {
    routeIndexes.set(fragment.route, index)
    routeOrientations.set(
      fragment.route,
      getRouteStitchOrientation({
        hdRoutes: [fragment.route],
        start: params.start,
        end: params.end,
      }).orientation,
    )
  }
  const getGapCost = (
    from: Point3,
    to: Point3,
    traceThickness: number,
    maximumDistance: number,
  ): number | null => {
    // A layer change belongs to represented via copper in a fragment. An
    // endpoint adjacency alone must not synthesize a terminal or blind via.
    if (from.z !== to.z) return null
    const gapDistance = distance(from, to)
    if (gapDistance < GEOMETRIC_STITCH_TOLERANCE) return 0
    if (gapDistance > maximumDistance) return null
    const key = JSON.stringify([
      from.x,
      from.y,
      from.z,
      to.x,
      to.y,
      to.z,
      traceThickness,
    ])
    const cachedCost = gapCosts.get(key)
    if (cachedCost !== undefined) return cachedCost
    const cost = params.isStitchSegmentClear({
      connectionName: params.connectionName,
      start: from,
      end: to,
      traceThickness,
    })
      ? 1
      : null
    gapCosts.set(key, cost)
    return cost
  }
  let bestPath: { path: OrderedRouteStitchEntry[]; cost: PathCost } | undefined
  // Each direction is screened at the width of its actual first fragment.
  // Only candidates agreeing with Single3's unchanged native orientation are
  // eligible, so reversing a plan cannot silently change its clearance width.
  for (const searchDirection of ["start-to-end", "end-to-start"] as const) {
    const searchStart =
      searchDirection === "start-to-end" ? params.start : params.end
    const searchEnd =
      searchDirection === "start-to-end" ? params.end : params.start
    const states = new Map<string, SearchState>()
    const pendingKeys = new Set<string>()
    const settledKeys = new Set<string>()

    for (const [fragmentIndex, fragment] of fragments.entries()) {
      if (
        fragment.start.pcb_port_id &&
        searchStart.pcb_port_id &&
        fragment.start.pcb_port_id !== searchStart.pcb_port_id
      ) {
        continue
      }
      const start = {
        ...searchStart,
        z: searchStart.availableZ?.includes(fragment.start.z)
          ? fragment.start.z
          : searchStart.z,
      }
      const traceThickness = fragment.route.traceThickness
      const gapCount = getGapCost(
        start,
        fragment.start,
        traceThickness,
        MAX_STITCH_GAP_DISTANCE_3,
      )
      if (gapCount === null) continue
      const orientationAnchorIndex = routeIndexes.get(fragment.route)!
      const key = `${fragmentIndex}:${traceThickness}:${orientationAnchorIndex}`
      states.set(key, {
        fragmentIndex,
        traceThickness,
        orientationAnchorIndex,
        cost: { gapCount, routeCount: 1 },
        previousKey: null,
      })
      pendingKeys.add(key)
    }

    let goal: { key: string; cost: PathCost } | undefined
    while (pendingKeys.size > 0) {
      let currentKey: string | undefined
      let currentState: SearchState | undefined
      for (const key of pendingKeys) {
        const candidate = states.get(key)!
        if (
          !currentState ||
          comparePathCosts(candidate.cost, currentState.cost) < 0
        ) {
          currentKey = key
          currentState = candidate
        }
      }
      if (currentKey === undefined || currentState === undefined) {
        throw new Error("Directed stitch search lost its pending state")
      }
      if (goal && comparePathCosts(currentState.cost, goal.cost) >= 0) break
      pendingKeys.delete(currentKey)
      settledKeys.add(currentKey)
      const current = fragments[currentState.fragmentIndex]!
      const end = {
        ...searchEnd,
        z: searchEnd.availableZ?.includes(current.end.z)
          ? current.end.z
          : searchEnd.z,
      }
      const endClaimMatches =
        !current.end.pcb_port_id ||
        !searchEnd.pcb_port_id ||
        current.end.pcb_port_id === searchEnd.pcb_port_id
      const endGapCount = endClaimMatches
        ? getGapCost(
            current.end,
            end,
            currentState.traceThickness,
            MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
          )
        : null
      const nativeOrientation = routeOrientations.get(
        fragments[currentState.orientationAnchorIndex]!.route,
      )
      if (endGapCount !== null && nativeOrientation === searchDirection) {
        const cost = {
          gapCount: currentState.cost.gapCount + endGapCount,
          routeCount: currentState.cost.routeCount,
        }
        if (!goal || comparePathCosts(cost, goal.cost) < 0) {
          goal = { key: currentKey, cost }
        }
      }

      for (const [fragmentIndex, next] of fragments.entries()) {
        const gapCount = getGapCost(
          current.end,
          next.start,
          currentState.traceThickness,
          MAX_STITCH_GAP_DISTANCE_3,
        )
        if (gapCount === null) continue
        let ancestorKey: string | null = currentKey
        let routeAlreadyConsumed = false
        const ancestorRoutes: HighDensityIntraNodeRoute[] = []
        while (ancestorKey !== null) {
          const ancestor = states.get(ancestorKey)
          if (!ancestor) {
            throw new Error("Directed stitch search lost its route history")
          }
          const ancestorRoute = fragments[ancestor.fragmentIndex]!.route
          ancestorRoutes.push(ancestorRoute)
          if (ancestorRoute === next.route) {
            routeAlreadyConsumed = true
            break
          }
          ancestorKey = ancestor.previousKey
        }
        if (routeAlreadyConsumed) continue
        const orientationAnchor = getRouteStitchOrientation({
          hdRoutes: [...ancestorRoutes, next.route],
          start: params.start,
          end: params.end,
        }).firstRoute
        const orientationAnchorIndex = routeIndexes.get(orientationAnchor)!
        const key = `${fragmentIndex}:${currentState.traceThickness}:${orientationAnchorIndex}`
        if (settledKeys.has(key)) continue
        const cost = {
          gapCount: currentState.cost.gapCount + gapCount,
          routeCount: currentState.cost.routeCount + 1,
        }
        const previousState = states.get(key)
        if (previousState && comparePathCosts(previousState.cost, cost) <= 0) {
          continue
        }
        states.set(key, {
          fragmentIndex,
          traceThickness: currentState.traceThickness,
          orientationAnchorIndex,
          cost,
          previousKey: currentKey,
        })
        pendingKeys.add(key)
      }
    }

    if (!goal) continue
    const pathInReverse: OrderedRouteStitchEntry[] = []
    let cursorKey: string | null = goal.key
    while (cursorKey !== null) {
      const state = states.get(cursorKey)
      if (!state) {
        throw new Error("Directed stitch search lost its predecessor state")
      }
      const fragment = fragments[state.fragmentIndex]!
      pathInReverse.push({ route: fragment.route, matchedOn: fragment.matchedOn })
      cursorKey = state.previousKey
    }
    const path = pathInReverse.reverse()
    const canonicalPath =
      searchDirection === "start-to-end"
        ? path
        : [...path].reverse().map(
            (entry): OrderedRouteStitchEntry => ({
              route: entry.route,
              matchedOn: entry.matchedOn === "first" ? "last" : "first",
            }),
          )
    if (!bestPath || comparePathCosts(goal.cost, bestPath.cost) < 0) {
      bestPath = { path: canonicalPath, cost: goal.cost }
    }
  }
  return bestPath ? bestPath.path : null
}
