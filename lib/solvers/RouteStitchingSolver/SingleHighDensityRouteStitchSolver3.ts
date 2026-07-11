import { distance, type Point3 } from "@tscircuit/math-utils"
import { GraphicsObject } from "graphics-debug"
import { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import { BaseSolver } from "../BaseSolver"
import {
  comparePoints,
  compareRoutes,
  DISTANCE_TIE_TOLERANCE,
  MAX_STITCH_GAP_DISTANCE_3,
  MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
  STITCH_GEOMETRIC_TOLERANCE,
} from "./routeStitchingShared"

const VIA_PENALTY = 1000
const GAP_PENALTY = 100000
const COORDINATE_EPSILON = 1e-9
type RoutePoint = HighDensityIntraNodeRoute["route"][number]
export {
  MAX_STITCH_GAP_DISTANCE_3,
  MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
} from "./routeStitchingShared"

const reverseRoutePoints = (points: RoutePoint[]): RoutePoint[] => {
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

export class SingleHighDensityRouteStitchSolver3 extends BaseSolver {
  override getSolverName(): string {
    return "SingleHighDensityRouteStitchSolver3"
  }

  mergedHdRoute!: HighDensityIntraNodeRoute
  remainingHdRoutes: HighDensityIntraNodeRoute[]
  start: Point3
  end: Point3
  colorMap: Record<string, string>
  allowedLayerTransitionPointKeys?: Set<string>

  constructor(opts: {
    connectionName: string
    hdRoutes: HighDensityIntraNodeRoute[]
    start: Point3
    end: Point3
    colorMap?: Record<string, string>
    defaultTraceThickness?: number
    defaultViaDiameter?: number
    allowedLayerTransitionPointKeys?: Set<string>
  }) {
    super()
    const canonicalHdRoutes = [...opts.hdRoutes].sort(compareRoutes)
    this.remainingHdRoutes = canonicalHdRoutes
    this.colorMap = opts.colorMap ?? {}
    this.allowedLayerTransitionPointKeys = opts.allowedLayerTransitionPointKeys

    if (canonicalHdRoutes.length === 0) {
      this.start = opts.start
      this.end = opts.end
      this.failed = true
      this.error = `Cannot stitch connection "${opts.connectionName}" without any high-density route fragments`
      return
    }

    let bestDist = Infinity
    let firstRoute = canonicalHdRoutes[0]
    let orientation: "start-to-end" | "end-to-start" = "start-to-end"

    for (const route of canonicalHdRoutes) {
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

      if (
        minDist < bestDist - DISTANCE_TIE_TOLERANCE ||
        (Math.abs(minDist - bestDist) <= DISTANCE_TIE_TOLERANCE &&
          compareRoutes(route, firstRoute!) < 0)
      ) {
        bestDist = minDist
        firstRoute = route
        if (
          Math.min(distEndToFirst, distEndToLast) <
            Math.min(distStartToFirst, distStartToLast) -
              DISTANCE_TIE_TOLERANCE ||
          (Math.abs(
            Math.min(distEndToFirst, distEndToLast) -
              Math.min(distStartToFirst, distStartToLast),
          ) <= DISTANCE_TIE_TOLERANCE &&
            comparePoints(opts.end, opts.start) < 0)
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

    this.mergedHdRoute = {
      connectionName: opts.connectionName,
      rootConnectionName: firstRoute.rootConnectionName,
      route: [
        {
          x: this.start.x,
          y: this.start.y,
          z: this.start.z,
        },
      ],
      vias: [],
      jumpers: [],
      viaDiameter: firstRoute.viaDiameter,
      traceThickness: firstRoute.traceThickness,
    }
  }

  private failStitch(reason: string): false {
    this.solved = false
    this.failed = true
    this.error = `Cannot stitch connection "${this.mergedHdRoute.connectionName}": ${reason}`
    return false
  }

  private appendLayerTransition(
    transitionPoint: RoutePoint,
    targetZ: number,
  ): boolean {
    const lastPoint =
      this.mergedHdRoute.route[this.mergedHdRoute.route.length - 1]
    if (lastPoint.z === targetZ) return true

    const transitionKey = getXyPointKey(transitionPoint)
    if (
      this.allowedLayerTransitionPointKeys &&
      !this.allowedLayerTransitionPointKeys.has(transitionKey)
    ) {
      return this.failStitch(
        `layer transition at ${transitionKey} is not allowed`,
      )
    }

    if (distance(lastPoint, transitionPoint) >= STITCH_GEOMETRIC_TOLERANCE) {
      return this.failStitch(
        `layer transition from z${lastPoint.z} to z${targetZ} is not coincident`,
      )
    }

    if (distance(lastPoint, transitionPoint) > COORDINATE_EPSILON) {
      this.mergedHdRoute.route.push({
        x: transitionPoint.x,
        y: transitionPoint.y,
        z: lastPoint.z,
      })
    }
    this.mergedHdRoute.route.push({
      ...transitionPoint,
      z: targetZ,
    })
    if (
      !this.mergedHdRoute.vias.some(
        (via) => distance(via, transitionPoint) < STITCH_GEOMETRIC_TOLERANCE,
      )
    ) {
      this.mergedHdRoute.vias.push({
        x: transitionPoint.x,
        y: transitionPoint.y,
      })
    }
    return true
  }

  private validateCompletedRoute(): boolean {
    const route = this.mergedHdRoute.route
    const firstPoint = route[0]
    const lastPoint = route[route.length - 1]
    if (
      firstPoint.z !== this.start.z ||
      distance(firstPoint, this.start) >= STITCH_GEOMETRIC_TOLERANCE
    ) {
      return this.failStitch("stitched route does not start at its terminal")
    }
    if (
      lastPoint.z !== this.end.z ||
      distance(lastPoint, this.end) >= STITCH_GEOMETRIC_TOLERANCE
    ) {
      return this.failStitch("stitched route does not end at its terminal")
    }

    return true
  }

  private finishAtTerminal(): void {
    const lastPoint =
      this.mergedHdRoute.route[this.mergedHdRoute.route.length - 1]
    const terminalGap = distance(lastPoint, this.end)
    if (terminalGap > MAX_TERMINAL_STITCH_GAP_DISTANCE_3) {
      this.failStitch(
        `terminal gap ${terminalGap.toFixed(3)}mm exceeds ${MAX_TERMINAL_STITCH_GAP_DISTANCE_3}mm`,
      )
      return
    }

    if (terminalGap > COORDINATE_EPSILON) {
      this.mergedHdRoute.route.push({
        x: this.end.x,
        y: this.end.y,
        z: lastPoint.z,
      })
    }
    if (!this.appendLayerTransition(this.end, this.end.z)) return
    if (!this.validateCompletedRoute()) return
    this.solved = true
  }

  getDisjointedRoute() {
    const TOL = STITCH_GEOMETRIC_TOLERANCE

    for (const candidate of this.remainingHdRoutes) {
      const candidateEnds = [
        candidate.route[0],
        candidate.route[candidate.route.length - 1],
      ]

      const hasLonelyEnd = candidateEnds.some((end) => {
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

    return { firstRoute: this.remainingHdRoutes[0] }
  }

  _step() {
    if (this.remainingHdRoutes.length === 0) {
      this.finishAtTerminal()
      return
    }

    const lastMergedPoint =
      this.mergedHdRoute.route[this.mergedHdRoute.route.length - 1]

    let closestRouteIndex = -1
    let matchedOn: "first" | "last" = "first"
    let bestScore = Infinity

    for (let i = 0; i < this.remainingHdRoutes.length; i++) {
      const hdRoute = this.remainingHdRoutes[i]
      const firstPointInCandidate = hdRoute.route[0]
      const lastPointInCandidate = hdRoute.route[hdRoute.route.length - 1]

      const distToFirst = distance(lastMergedPoint, firstPointInCandidate)
      const distToLast = distance(lastMergedPoint, lastPointInCandidate)

      let scoreFirst = Infinity
      if (lastMergedPoint.z === firstPointInCandidate.z) {
        if (distToFirst < STITCH_GEOMETRIC_TOLERANCE) {
          scoreFirst = distToFirst
        } else if (distToFirst <= MAX_STITCH_GAP_DISTANCE_3) {
          scoreFirst = GAP_PENALTY + distToFirst
        }
      } else if (
        distToFirst < STITCH_GEOMETRIC_TOLERANCE &&
        (!this.allowedLayerTransitionPointKeys ||
          this.allowedLayerTransitionPointKeys.has(
            getXyPointKey(firstPointInCandidate),
          ))
      ) {
        scoreFirst = VIA_PENALTY + distToFirst
      }

      if (scoreFirst < bestScore) {
        bestScore = scoreFirst
        closestRouteIndex = i
        matchedOn = "first"
      }

      let scoreLast = Infinity
      if (lastMergedPoint.z === lastPointInCandidate.z) {
        if (distToLast < STITCH_GEOMETRIC_TOLERANCE) {
          scoreLast = distToLast
        } else if (distToLast <= MAX_STITCH_GAP_DISTANCE_3) {
          scoreLast = GAP_PENALTY + distToLast
        }
      } else if (
        distToLast < STITCH_GEOMETRIC_TOLERANCE &&
        (!this.allowedLayerTransitionPointKeys ||
          this.allowedLayerTransitionPointKeys.has(
            getXyPointKey(lastPointInCandidate),
          ))
      ) {
        scoreLast = VIA_PENALTY + distToLast
      }

      if (scoreLast < bestScore) {
        bestScore = scoreLast
        closestRouteIndex = i
        matchedOn = "last"
      }
    }

    if (closestRouteIndex === -1) {
      this.failStitch(
        `no stitchable fragment remains near (${lastMergedPoint.x.toFixed(3)}, ${lastMergedPoint.y.toFixed(3)}, z${lastMergedPoint.z}); ${this.remainingHdRoutes.length} fragment(s) remain`,
      )
      return
    }

    const hdRouteToMerge = this.remainingHdRoutes[closestRouteIndex]
    this.remainingHdRoutes.splice(closestRouteIndex, 1)

    let pointsToAdd: RoutePoint[]
    if (matchedOn === "first") {
      pointsToAdd = hdRouteToMerge.route
    } else {
      pointsToAdd = reverseRoutePoints(hdRouteToMerge.route)
    }

    const firstPointToAdd = pointsToAdd[0]
    if (!firstPointToAdd) {
      this.failStitch("encountered an empty high-density route fragment")
      return
    }

    if (
      lastMergedPoint.z !== firstPointToAdd.z &&
      !this.appendLayerTransition(firstPointToAdd, firstPointToAdd.z)
    ) {
      return
    }

    const pointBeforeAppend =
      this.mergedHdRoute.route[this.mergedHdRoute.route.length - 1]
    if (
      distance(pointBeforeAppend, firstPointToAdd) <= COORDINATE_EPSILON &&
      pointBeforeAppend.z === firstPointToAdd.z
    ) {
      if (pointsToAdd[0].toNextSegmentType) {
        pointBeforeAppend.toNextSegmentType = pointsToAdd[0].toNextSegmentType
      }
      this.mergedHdRoute.route.push(...pointsToAdd.slice(1))
    } else {
      this.mergedHdRoute.route.push(...pointsToAdd)
    }

    for (const via of hdRouteToMerge.vias) {
      if (
        !this.mergedHdRoute.vias.some(
          (mergedVia) => distance(mergedVia, via) < STITCH_GEOMETRIC_TOLERANCE,
        )
      ) {
        this.mergedHdRoute.vias.push(via)
      }
    }

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
      title: "Single High Density Route Stitch Solver 3",
    }

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

    if (this.mergedHdRoute && this.mergedHdRoute.route.length > 1) {
      graphics.lines?.push({
        points: this.mergedHdRoute.route.map((point) => ({
          x: point.x,
          y: point.y,
        })),
        strokeColor: "green",
      })

      for (const point of this.mergedHdRoute.route) {
        graphics.points?.push({
          x: point.x,
          y: point.y,
          color: "green",
        })
      }

      for (const via of this.mergedHdRoute.vias) {
        graphics.circles?.push({
          center: { x: via.x, y: via.y },
          radius: this.mergedHdRoute.viaDiameter / 2,
          fill: "green",
        })
      }

      if (this.mergedHdRoute.jumpers && this.mergedHdRoute.jumpers.length > 0) {
        const jumperGraphics = getJumpersGraphics(this.mergedHdRoute.jumpers, {
          color: "green",
          label: this.mergedHdRoute.connectionName,
        })
        graphics.rects!.push(...(jumperGraphics.rects ?? []))
        graphics.lines!.push(...(jumperGraphics.lines ?? []))
      }
    }

    for (const hdRoute of this.remainingHdRoutes) {
      graphics.lines?.push({
        points: hdRoute.route.map((point) => ({
          x: point.x,
          y: point.y,
        })),
        strokeColor: "orange",
      })

      for (const point of hdRoute.route) {
        graphics.points?.push({
          x: point.x,
          y: point.y,
          color: "orange",
        })
      }

      for (const via of hdRoute.vias) {
        graphics.circles?.push({
          center: { x: via.x, y: via.y },
          radius: hdRoute.viaDiameter / 2,
          fill: "orange",
        })
      }

      if (hdRoute.jumpers && hdRoute.jumpers.length > 0) {
        const jumperGraphics = getJumpersGraphics(hdRoute.jumpers, {
          color: "orange",
          label: hdRoute.connectionName,
        })
        graphics.rects!.push(...(jumperGraphics.rects ?? []))
        graphics.lines!.push(...(jumperGraphics.lines ?? []))
      }
    }

    return graphics
  }
}
