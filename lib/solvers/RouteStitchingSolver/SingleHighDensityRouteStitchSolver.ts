import { HighDensityIntraNodeRoute, Jumper } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { GraphicsObject } from "graphics-debug"
import { distance } from "@tscircuit/math-utils"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"

const VIA_PENALTY = 1000
const GAP_PENALTY = 100000
const GEOMETRIC_TOLERANCE = 1e-3

export class SingleHighDensityRouteStitchSolver extends BaseSolver {
  override getSolverName(): string {
    return "SingleHighDensityRouteStitchSolver"
  }

  mergedHdRoute: HighDensityIntraNodeRoute
  remainingHdRoutes: HighDensityIntraNodeRoute[]
  start: { x: number; y: number; z: number }
  end: { x: number; y: number; z: number }
  colorMap: Record<string, string>

  constructor(opts: {
    connectionName: string
    hdRoutes: HighDensityIntraNodeRoute[]
    start: { x: number; y: number; z: number }
    end: { x: number; y: number; z: number }
    colorMap?: Record<string, string>
    defaultTraceThickness?: number
    defaultViaDiameter?: number
  }) {
    super()
    this.remainingHdRoutes = [...opts.hdRoutes]
    this.colorMap = opts.colorMap ?? {} // Store colorMap, default to empty object

    if (opts.hdRoutes.length === 0) {
      this.start = opts.start
      this.end = opts.end
      const routePoints = [
        { x: opts.start.x, y: opts.start.y, z: opts.start.z },
      ]
      const vias = []

      if (opts.start.z !== opts.end.z) {
        // If layers are different, add a via at the start point and a segment on the new layer
        routePoints.push({ x: opts.start.x, y: opts.start.y, z: opts.end.z })
        vias.push({ x: opts.start.x, y: opts.start.y })
      }
      routePoints.push({ x: opts.end.x, y: opts.end.y, z: opts.end.z })

      this.mergedHdRoute = {
        connectionName: opts.connectionName,
        rootConnectionName: opts.hdRoutes[0]?.rootConnectionName,
        route: routePoints,
        vias: vias,
        jumpers: [],
        viaDiameter: opts.defaultViaDiameter ?? 0.6, // Use default or fallback
        traceThickness: opts.defaultTraceThickness ?? 0.15, // Use default or fallback
      }
      this.solved = true
      return // Early exit as there's nothing to stitch
    }

    // Find the route closest to the global start or end to serve as the "seed" route.
    // This is more robust than looking for "disjoint" ends, which can fail with small gaps.
    let bestDist = Infinity
    let firstRoute = opts.hdRoutes[0]
    let orientation: "start-to-end" | "end-to-start" = "start-to-end"

    for (const route of opts.hdRoutes) {
      const firstPoint = route.route[0]
      const lastPoint = route.route[route.route.length - 1]

      const distStartToFirst = distance(opts.start, firstPoint)
      const distStartToLast = distance(opts.start, lastPoint)
      const distEndToFirst = distance(opts.end, firstPoint)
      const distEndToLast = distance(opts.end, lastPoint)

      const minDist = Math.min(
        distStartToFirst,
        distStartToLast,
        distEndToFirst,
        distEndToLast,
      )

      if (minDist < bestDist) {
        bestDist = minDist
        firstRoute = route
        if (
          Math.min(distEndToFirst, distEndToLast) <
          Math.min(distStartToFirst, distStartToLast)
        ) {
          orientation = "end-to-start"
        } else {
          orientation = "start-to-end"
        }
      }
    }

    if (orientation === "start-to-end") {
      this.start = opts.start
      this.end = opts.end
    } else {
      this.start = opts.end
      this.end = opts.start
    }

    // Determine the best z-value for the start point by looking at the closest
    // point of the first route. This handles multi-layer connection points
    // where the connection point supports multiple layers but the route is on
    // a specific layer.
    const firstRouteFirstPoint = firstRoute.route[0]
    const firstRouteLastPoint = firstRoute.route[firstRoute.route.length - 1]
    const distToFirst = distance(this.start, firstRouteFirstPoint)
    const distToLast = distance(this.start, firstRouteLastPoint)
    const closestFirstRoutePoint =
      distToFirst <= distToLast ? firstRouteFirstPoint : firstRouteLastPoint

    this.mergedHdRoute = {
      connectionName: opts.connectionName, // Use mandatory connectionName
      rootConnectionName: firstRoute.rootConnectionName,
      route: [
        {
          x: this.start.x,
          y: this.start.y,
          z: closestFirstRoutePoint.z,
        },
      ],
      vias: [],
      jumpers: [],
      viaDiameter: firstRoute.viaDiameter,
      traceThickness: firstRoute.traceThickness,
    }
  }

  /**
   * Scan `remainingHdRoutes` and find a route that has **one** end that is not
   * within `1e-3` of the start or end of any other route on the same layer.
   * That “lonely” end marks one extremity of the whole chain, which we use as
   * our starting segment. If no such route exists (e.g., the data form a loop),
   * we simply return the first route so the solver can proceed.
   */
  getDisjointedRoute() {
    const TOL = GEOMETRIC_TOLERANCE

    for (const candidate of this.remainingHdRoutes) {
      const candidateEnds = [
        candidate.route[0],
        candidate.route[candidate.route.length - 1],
      ]

      // true if at least one end of `candidate` is not matched by any other route
      const hasLonelyEnd = candidateEnds.some((end) => {
        // Look through every *other* route and its two ends
        return !this.remainingHdRoutes.some((other) => {
          if (other === candidate) return false
          const otherEnds = [
            other.route[0],
            other.route[other.route.length - 1],
          ]
          return otherEnds.some(
            (oe) => oe.z === end.z && distance(end, oe) < TOL,
          )
        })
      })

      if (hasLonelyEnd) {
        return { firstRoute: candidate }
      }
    }

    // Degenerate case: everything is paired (forms a loop) – just pick the first route
    return { firstRoute: this.remainingHdRoutes[0] }
  }

  _step() {
    if (this.remainingHdRoutes.length === 0) {
      // Add the end point to the merged route
      // Use the z-value of the last merged point to handle multi-layer connection
      // points where the route is on a specific layer
      const lastMergedPoint =
        this.mergedHdRoute.route[this.mergedHdRoute.route.length - 1]
      this.mergedHdRoute.route.push({
        x: this.end.x,
        y: this.end.y,
        z: lastMergedPoint.z,
      })
      this.solved = true
      return
    }

    const lastMergedPoint =
      this.mergedHdRoute.route[this.mergedHdRoute.route.length - 1]

    // Find the next logical route to merge
    // 1. We need to check both the first and last points of the remaining routes
    // 2. If the last point is closest, we need to reverse the hd route before merging
    // 3. After merging, we remove it from the remaining routes

    // Find the next logical route to merge using prioritized selection
    // Priority 1: Same layer, connected (or very close)
    // Priority 2: Different layer, same X/Y (Via)
    // Priority 3: Closest endpoint (Gap bridging)

    let closestRouteIndex = -1
    let matchedOn: "first" | "last" = "first"
    let bestScore = Infinity

    for (let i = 0; i < this.remainingHdRoutes.length; i++) {
      const hdRoute = this.remainingHdRoutes[i]
      const firstPointInCandidate = hdRoute.route[0]
      const lastPointInCandidate = hdRoute.route[hdRoute.route.length - 1]

      const distToFirst = distance(lastMergedPoint, firstPointInCandidate)
      const distToLast = distance(lastMergedPoint, lastPointInCandidate)

      // Evaluate "First" end
      let scoreFirst = Infinity
      if (lastMergedPoint.z === firstPointInCandidate.z) {
        if (distToFirst < GEOMETRIC_TOLERANCE) {
          scoreFirst = distToFirst // Connected on same layer
        } else {
          scoreFirst = GAP_PENALTY + distToFirst // Gap on same layer
        }
      } else {
        // Different Z
        if (distToFirst < GEOMETRIC_TOLERANCE) {
          scoreFirst = VIA_PENALTY + distToFirst // Via transition
        } else {
          scoreFirst = GAP_PENALTY + distToFirst // Gap on different layer
        }
      }

      if (scoreFirst < bestScore) {
        bestScore = scoreFirst
        closestRouteIndex = i
        matchedOn = "first"
      }

      // Evaluate "Last" end
      let scoreLast = Infinity
      if (lastMergedPoint.z === lastPointInCandidate.z) {
        if (distToLast < GEOMETRIC_TOLERANCE) {
          scoreLast = distToLast // Connected on same layer
        } else {
          scoreLast = GAP_PENALTY + distToLast // Gap on same layer
        }
      } else {
        // Different Z
        if (distToLast < GEOMETRIC_TOLERANCE) {
          scoreLast = VIA_PENALTY + distToLast // Via transition
        } else {
          scoreLast = GAP_PENALTY + distToLast // Gap on different layer
        }
      }

      if (scoreLast < bestScore) {
        bestScore = scoreLast
        closestRouteIndex = i
        matchedOn = "last"
      }
    }

    if (closestRouteIndex === -1) {
      // Should not happen given the gap fallback, but if no routes remain, we are done
      this.remainingHdRoutes = [] // Force exit next step
      return
    }

    const hdRouteToMerge = this.remainingHdRoutes[closestRouteIndex]
    this.remainingHdRoutes.splice(closestRouteIndex, 1)

    let pointsToAdd: Array<{ x: number; y: number; z: number }>
    if (matchedOn === "first") {
      pointsToAdd = hdRouteToMerge.route
    } else {
      pointsToAdd = [...hdRouteToMerge.route].reverse()
    }

    if (
      pointsToAdd.length > 0 &&
      distance(lastMergedPoint, pointsToAdd[0]) < GEOMETRIC_TOLERANCE &&
      lastMergedPoint.z === pointsToAdd[0].z
    ) {
      this.mergedHdRoute.route.push(...pointsToAdd.slice(1))
    } else {
      this.mergedHdRoute.route.push(...pointsToAdd)
    }

    this.mergedHdRoute.vias.push(...hdRouteToMerge.vias)

    // Merge jumpers if present
    if (hdRouteToMerge.jumpers) {
      this.mergedHdRoute.jumpers!.push(...hdRouteToMerge.jumpers)
    }
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      points: [],
      lines: [],
      circles: [],
      rects: [],
      title: "Single High Density Route Stitch Solver",
    }

    // Visualize start and end points
    graphics.points?.push(
      {
        x: this.start.x,
        y: this.start.y,
        color: "green",
        label: "Start",
      },
      {
        x: this.end.x,
        y: this.end.y,
        color: "red",
        label: "End",
      },
    )

    // Visualize the merged HD route in green
    if (this.mergedHdRoute && this.mergedHdRoute.route.length > 1) {
      graphics.lines?.push({
        points: this.mergedHdRoute.route.map((point) => ({
          x: point.x,
          y: point.y,
        })),
        strokeColor: "green",
      })

      // Add points for the merged route
      for (const point of this.mergedHdRoute.route) {
        graphics.points?.push({
          x: point.x,
          y: point.y,
          color: "green",
        })
      }

      // Visualize vias in the merged route
      for (const via of this.mergedHdRoute.vias) {
        graphics.circles?.push({
          center: { x: via.x, y: via.y },
          radius: this.mergedHdRoute.viaDiameter / 2,
          fill: "green",
        })
      }

      // Visualize jumpers in the merged route
      if (this.mergedHdRoute.jumpers && this.mergedHdRoute.jumpers.length > 0) {
        const jumperGraphics = getJumpersGraphics(this.mergedHdRoute.jumpers, {
          color: "green",
          label: this.mergedHdRoute.connectionName,
        })
        graphics.rects!.push(...(jumperGraphics.rects ?? []))
        graphics.lines!.push(...(jumperGraphics.lines ?? []))
      }
    }

    // Visualize all remaining HD routes using colorMap
    for (const [i, hdRoute] of this.remainingHdRoutes.entries()) {
      const routeColor = this.colorMap[hdRoute.connectionName] ?? "gray" // Default to gray if not in map
      if (hdRoute.route.length > 1) {
        // Create a line for the route
        graphics.lines?.push({
          points: hdRoute.route.map((point) => ({ x: point.x, y: point.y })),
          strokeColor: routeColor,
        })
      }

      // Add points for each route node
      for (let pi = 0; pi < hdRoute.route.length; pi++) {
        const point = hdRoute.route[pi]
        graphics.points?.push({
          x: point.x + ((i % 2) - 0.5) / 500 + ((pi % 8) - 4) / 1000, // Keep slight offset for visibility
          y: point.y + ((i % 2) - 0.5) / 500 + ((pi % 8) - 4) / 1000,
          color: routeColor,
          label: `Route ${hdRoute.connectionName} ${point === hdRoute.route[0] ? "First" : point === hdRoute.route[hdRoute.route.length - 1] ? "Last" : ""}`,
        })
      }

      // Visualize vias
      for (const via of hdRoute.vias) {
        graphics.circles?.push({
          center: { x: via.x, y: via.y },
          radius: hdRoute.viaDiameter / 2,
          fill: routeColor,
        })
      }

      // Visualize jumpers
      if (hdRoute.jumpers && hdRoute.jumpers.length > 0) {
        const jumperGraphics = getJumpersGraphics(hdRoute.jumpers, {
          color: routeColor,
          label: hdRoute.connectionName,
        })
        graphics.rects!.push(...(jumperGraphics.rects ?? []))
        graphics.lines!.push(...(jumperGraphics.lines ?? []))
      }
    }

    return graphics
  }
}
