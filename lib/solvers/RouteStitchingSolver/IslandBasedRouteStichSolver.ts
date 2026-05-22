import type { GraphicsObject, Line } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { getStringColor } from "lib/solvers/colors"
import type { RouteIsland } from "lib/solvers/RouteIslandSolver/RouteIslandSolver"
import type { HighDensityRoute, PortPoint } from "lib/types/high-density-types"

const ROUTE_ISLAND_HD_ROUTE_MATCH_TOLERANCE = 1e-3
type RoutePoint = HighDensityRoute["route"][number]

/**
 * Reverses a high-density route while preserving segment metadata direction.
 *
 * @param points Route points to reverse.
 * @returns New route point array with `toNextSegmentType` moved to the correct
 * reversed segment.
 */
const reverseHdRoutePoints = (points: RoutePoint[]): RoutePoint[] => {
  const reversed = [...points].reverse().map((point) => {
    const { toNextSegmentType, ...rest } = point
    return rest
  }) as RoutePoint[]

  for (let i = 0; i < points.length - 1; i++) {
    const segmentType = points[i]?.toNextSegmentType
    if (!segmentType) continue
    const reversedStartIndex = points.length - i - 2
    reversed[reversedStartIndex] = {
      ...reversed[reversedStartIndex]!,
      toNextSegmentType: segmentType,
    }
  }

  return reversed
}

/**
 * Matched high-density route segment for a route-island port-point pair.
 */
type IslandRouteMatch = {
  hdRoute: HighDensityRoute
  portPointPair: [PortPoint, PortPoint]
  /** Whether the route must be reversed before appending to the island route. */
  shouldReverse: boolean
}

/**
 * Stitches high-density route fragments by following route islands.
 *
 * The solver consumes route islands from `RouteIslandSolver`, matches each
 * island's port-point pairs to high-density routes, and emits merged routes
 * plus any unmatched routes that should pass through unchanged.
 *
 * @param input.islands Route islands that define desired segment order.
 * @param input.hdRoutes High-density routes to stitch or pass through.
 * @returns Merged high-density routes via {@link getOutput} after solving.
 */
export class IslandBasedRouteStichSolver extends BaseSolver {
  mergedHdRoutes: HighDensityRoute[] = []
  private islandQueue: RouteIsland[]
  private remainingHdRoutes: HighDensityRoute[]
  private activeIsland: RouteIsland | null = null
  private activeIslandRouteMatches: IslandRouteMatch[] = []

  /**
   * Creates an island-based route stitching solver.
   *
   * @param input Route islands and high-density route fragments.
   */
  constructor(
    private input: {
      islands: RouteIsland[]
      hdRoutes: HighDensityRoute[]
    },
  ) {
    super()
    this.MAX_ITERATIONS = 1e6
    this.islandQueue = [...input.islands]
    this.remainingHdRoutes = [...input.hdRoutes]
    this.updateStats()
  }

  /**
   * Measures endpoint distance between a route point and port point.
   *
   * @param routePoint Route endpoint candidate.
   * @param portPoint Port point to compare against.
   * @returns Euclidean XY distance on the same layer, or `Infinity` for layer mismatch.
   */
  private getPortPointDistance(
    routePoint: HighDensityRoute["route"][number],
    portPoint: PortPoint,
  ) {
    if (routePoint.z !== portPoint.z) return Infinity
    return Math.hypot(routePoint.x - portPoint.x, routePoint.y - portPoint.y)
  }

  /**
   * Checks whether a route endpoint is close enough to a port point.
   *
   * @param routePoint Route endpoint candidate.
   * @param portPoint Port point to match.
   * @returns True when the endpoint is within the route-island match tolerance.
   */
  private routePointMatchesPortPoint(
    routePoint: HighDensityRoute["route"][number],
    portPoint: PortPoint,
  ) {
    return (
      this.getPortPointDistance(routePoint, portPoint) <=
      ROUTE_ISLAND_HD_ROUTE_MATCH_TOLERANCE
    )
  }

  /**
   * Matches a high-density route to an island port-point pair.
   *
   * @param hdRoute Candidate high-density route.
   * @param portPointPair Island pair that should bound the route.
   * @returns Match metadata, including reversal requirement, or null when unmatched.
   */
  private getRouteMatchForPortPointPair(
    hdRoute: HighDensityRoute,
    portPointPair: [PortPoint, PortPoint],
  ): IslandRouteMatch | null {
    const start = hdRoute.route[0]
    const end = hdRoute.route[hdRoute.route.length - 1]
    if (!start || !end) return null

    if (
      this.routePointMatchesPortPoint(start, portPointPair[0]) &&
      this.routePointMatchesPortPoint(end, portPointPair[1])
    ) {
      return { hdRoute, portPointPair, shouldReverse: false }
    }

    if (
      this.routePointMatchesPortPoint(start, portPointPair[1]) &&
      this.routePointMatchesPortPoint(end, portPointPair[0])
    ) {
      return { hdRoute, portPointPair, shouldReverse: true }
    }

    return null
  }

  /**
   * Flattens all port-point pairs from an island in island order.
   *
   * @param island Route island to inspect.
   * @returns Port-point pairs from all island regions.
   */
  private getIslandPortPointPairs(island: RouteIsland) {
    return island.regionsAndPortPointPairs.flatMap(
      ({ portPointPairs }) => portPointPairs,
    )
  }

  /**
   * Gets the best start marker for visualization.
   *
   * @param island Route island to inspect.
   * @returns Explicit start terminal when present, otherwise the first pair's first point.
   */
  private getIslandStartPortPoint(island: RouteIsland) {
    const firstRegion = island.regionsAndPortPointPairs[0]
    if (!firstRegion) return null

    return (
      firstRegion.portPointPairs
        .flat()
        .find((portPoint) =>
          portPoint.portPointId?.includes("tiny-terminal:start-port:"),
        ) ??
      firstRegion.portPointPairs[0]?.[0] ??
      null
    )
  }

  /**
   * Gets the best end marker for visualization.
   *
   * @param island Route island to inspect.
   * @returns Explicit end terminal when present, otherwise the last pair's second point.
   */
  private getIslandEndPortPoint(island: RouteIsland) {
    const lastRegion =
      island.regionsAndPortPointPairs[
        island.regionsAndPortPointPairs.length - 1
      ]
    if (!lastRegion) return null

    return (
      lastRegion.portPointPairs
        .flat()
        .find((portPoint) =>
          portPoint.portPointId?.includes("tiny-terminal:end-port:"),
        ) ??
      lastRegion.portPointPairs.at(-1)?.[1] ??
      null
    )
  }

  /**
   * Selects remaining high-density routes claimed by an island.
   *
   * @param island Route island whose pairs should be matched.
   * @returns Matched route fragments in island pair order.
   *
   * NOTE: A high-density route can be selected only once per island.
   */
  private selectRouteMatchesForIsland(island: RouteIsland) {
    const islandPortPointPairs = this.getIslandPortPointPairs(island)
    const selectedRouteMatches: IslandRouteMatch[] = []
    const usedHdRoutes = new Set<HighDensityRoute>()

    for (const portPointPair of islandPortPointPairs) {
      for (const hdRoute of this.remainingHdRoutes) {
        if (usedHdRoutes.has(hdRoute)) continue
        if (hdRoute.connectionName !== island.connectionName) continue
        const routeMatch = this.getRouteMatchForPortPointPair(
          hdRoute,
          portPointPair,
        )
        if (!routeMatch) continue

        selectedRouteMatches.push(routeMatch)
        usedHdRoutes.add(hdRoute)
        break
      }
    }

    return selectedRouteMatches
  }

  /**
   * Removes selected route fragments from the unmatched-route pool.
   *
   * @param routeMatches Route matches already claimed by an island.
   * @returns Nothing; mutates `remainingHdRoutes`.
   */
  private removeFromRemainingHdRoutes(routeMatches: IslandRouteMatch[]) {
    const hdRoutesToRemoveSet = new Set(
      routeMatches.map((routeMatch) => routeMatch.hdRoute),
    )
    this.remainingHdRoutes = this.remainingHdRoutes.filter(
      (hdRoute) => !hdRoutesToRemoveSet.has(hdRoute),
    )
  }

  /**
   * Checks whether two route points match in XY and layer.
   *
   * @param left First route point.
   * @param right Second route point.
   * @returns True when both points are within tolerance on the same layer.
   */
  private pointMatchesPoint(left: RoutePoint, right: RoutePoint) {
    return (
      left.z === right.z &&
      Math.hypot(left.x - right.x, left.y - right.y) <=
        ROUTE_ISLAND_HD_ROUTE_MATCH_TOLERANCE
    )
  }

  /**
   * Checks whether two route points match in XY regardless of layer.
   *
   * @param left First route point.
   * @param right Second route point.
   * @returns True when XY positions are within tolerance.
   */
  private pointXyMatchesPoint(left: RoutePoint, right: RoutePoint) {
    return (
      Math.hypot(left.x - right.x, left.y - right.y) <=
      ROUTE_ISLAND_HD_ROUTE_MATCH_TOLERANCE
    )
  }

  /**
   * Gets route points in the direction required by the matched island pair.
   *
   * @param routeMatch Matched route and reversal metadata.
   * @returns Route points ready to append to the merged route.
   */
  private getRoutePointsForMatch(routeMatch: IslandRouteMatch) {
    return routeMatch.shouldReverse
      ? reverseHdRoutePoints(routeMatch.hdRoute.route)
      : [...routeMatch.hdRoute.route]
  }

  /**
   * Appends route points into a merged route, deduping joined endpoints.
   *
   * @param mergedRoute Route being built for one island.
   * @param routePoints Route points to append.
   * @returns Nothing; mutates `mergedRoute`.
   *
   * CAUTION: A via is inserted only when consecutive endpoints share XY but
   * differ by layer.
   */
  private appendRoutePoints(
    mergedRoute: HighDensityRoute,
    routePoints: RoutePoint[],
  ) {
    const lastPoint = mergedRoute.route[mergedRoute.route.length - 1]
    const firstPoint = routePoints[0]

    if (!lastPoint || !firstPoint) {
      mergedRoute.route.push(...routePoints)
      return
    }

    if (this.pointMatchesPoint(lastPoint, firstPoint)) {
      if (firstPoint.toNextSegmentType) {
        lastPoint.toNextSegmentType = firstPoint.toNextSegmentType
      }
      mergedRoute.route.push(...routePoints.slice(1))
      return
    }

    if (
      this.pointXyMatchesPoint(lastPoint, firstPoint) &&
      lastPoint.z !== firstPoint.z
    ) {
      mergedRoute.vias.push({ x: firstPoint.x, y: firstPoint.y })
    }

    mergedRoute.route.push(...routePoints)
  }

  /**
   * Stitches all selected route fragments for one island.
   *
   * @param island Island that defines the output route order.
   * @param routeMatches Matched route fragments in island order.
   * @returns Merged high-density route, or null when there are no matches.
   */
  private stitchIslandRouteMatches(
    island: RouteIsland,
    routeMatches: IslandRouteMatch[],
  ): HighDensityRoute | null {
    const firstMatch = routeMatches[0]
    if (!firstMatch) return null

    const firstRoute = firstMatch.hdRoute
    const mergedRoute: HighDensityRoute = {
      connectionName: island.connectionName,
      rootConnectionName:
        island.rootConnectionName ?? firstRoute.rootConnectionName,
      route: [],
      vias: [],
      jumpers: [],
      traceThickness: firstRoute.traceThickness,
      viaDiameter: firstRoute.viaDiameter,
    }

    for (const routeMatch of routeMatches) {
      const routePoints = this.getRoutePointsForMatch(routeMatch)
      this.appendRoutePoints(mergedRoute, routePoints)
      mergedRoute.vias.push(...routeMatch.hdRoute.vias)
      if (routeMatch.hdRoute.jumpers) {
        mergedRoute.jumpers!.push(...routeMatch.hdRoute.jumpers)
      }
    }

    return mergedRoute
  }

  /**
   * Refreshes BaseSolver stats for visualization and debugging.
   *
   * @returns Nothing; mutates `stats`.
   */
  private updateStats() {
    this.stats = {
      islandCount: this.input.islands.length,
      pendingIslandCount: this.islandQueue.length,
      mergedRouteCount: this.mergedHdRoutes.length,
      remainingHdRouteCount: this.remainingHdRoutes.length,
      currentConnectionName: this.activeIsland?.connectionName ?? null,
      activeIslandHdRouteCount: this.activeIslandRouteMatches.length,
    }
  }

  /**
   * Processes the next route island and appends any final unmatched routes.
   *
   * @returns Nothing; updates merged routes and marks solved at completion.
   */
  _step(): void {
    if (this.islandQueue.length === 0) {
      this.mergedHdRoutes.push(...this.remainingHdRoutes)
      this.remainingHdRoutes = []
      this.solved = true
      this.updateStats()
      return
    }

    const island = this.islandQueue.shift()!
    this.activeIsland = island
    const routeMatches = this.selectRouteMatchesForIsland(island)
    this.activeIslandRouteMatches = routeMatches

    if (routeMatches.length === 0) {
      this.activeIsland = null
      this.activeIslandRouteMatches = []
      this.updateStats()
      return
    }

    this.removeFromRemainingHdRoutes(routeMatches)
    const mergedRoute = this.stitchIslandRouteMatches(island, routeMatches)
    if (mergedRoute) {
      this.mergedHdRoutes.push(mergedRoute)
    } else {
      this.mergedHdRoutes.push(
        ...routeMatches.map((routeMatch) => routeMatch.hdRoute),
      )
    }

    this.activeIsland = null
    this.activeIslandRouteMatches = []
    this.updateStats()
  }

  /**
   * Gets merged and pass-through high-density routes.
   *
   * @returns Complete route output after the solver is solved.
   */
  getOutput(): HighDensityRoute[] {
    return this.mergedHdRoutes
  }

  /**
   * Returns constructor parameters for solver replay/debug tooling.
   *
   * @returns Tuple containing the original solver input object.
   */
  getConstructorParams() {
    return [this.input] as const
  }

  /**
   * Builds a debug visualization of stitched and pending island routes.
   *
   * @returns Graphics object with stitched route lines and pending island markers.
   */
  visualize(): GraphicsObject {
    const lines: Line[] = []
    const points: NonNullable<GraphicsObject["points"]> = []

    for (const hdRoute of this.mergedHdRoutes) {
      lines.push({
        points: hdRoute.route.map((point) => ({ x: point.x, y: point.y })),
        strokeColor: getStringColor(hdRoute.connectionName, 0.85),
        label: `stitched route\nconnection: ${hdRoute.connectionName}`,
      })
    }

    for (const island of this.islandQueue) {
      const start = this.getIslandStartPortPoint(island)
      const end = this.getIslandEndPortPoint(island)
      if (start) {
        points.push({
          x: start.x,
          y: start.y,
          color: getStringColor(island.connectionName, 0.35),
          label: `pending island start\n${island.connectionName}`,
        })
      }
      if (end) {
        points.push({
          x: end.x,
          y: end.y,
          color: getStringColor(island.connectionName, 0.35),
          label: `pending island end\n${island.connectionName}`,
        })
      }
    }

    return {
      title: "New Stich Solver",
      lines,
      points,
    }
  }
}
