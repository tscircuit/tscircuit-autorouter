import { distance, type Point3 } from "@tscircuit/math-utils"
import { GraphicsObject } from "graphics-debug"
import { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import { BaseSolver } from "../BaseSolver"
import type { IsStitchSegmentClear } from "./route-stitch-clearance-validator"
import {
  comparePoints,
  compareRoutes,
  DISTANCE_TIE_TOLERANCE,
  MAX_STITCH_GAP_DISTANCE_3,
  MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
} from "./routeStitchingShared"

const VIA_PENALTY = 1000
const GAP_PENALTY = 100000
const GEOMETRIC_TOLERANCE = 1e-3
const COLLISION_PENALTY = MAX_STITCH_GAP_DISTANCE_3 + DISTANCE_TIE_TOLERANCE
type RoutePoint = HighDensityIntraNodeRoute["route"][number]
type StitchTerminal = Point3 & { pcb_port_id?: string }
type PcbPortId = NonNullable<StitchTerminal["pcb_port_id"]>
type TerminalRouteEndpoint = {
  route: HighDensityIntraNodeRoute
  routePoint: RoutePoint
  orientation: "start-to-end" | "end-to-start"
}
export type StitchClearanceMode = "require_clear" | "prefer_clear"
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

const getTerminalRouteEndpoint = (params: {
  hdRoutes: HighDensityIntraNodeRoute[]
  startPcbPortId?: PcbPortId
  endPcbPortId?: PcbPortId
}): TerminalRouteEndpoint | undefined => {
  if (params.startPcbPortId !== undefined) {
    for (const route of params.hdRoutes) {
      if (route.startPcbPortId === params.startPcbPortId) {
        return {
          route,
          routePoint: route.route[0]!,
          orientation: "start-to-end",
        }
      }
      if (route.endPcbPortId === params.startPcbPortId) {
        return {
          route,
          routePoint: route.route[route.route.length - 1]!,
          orientation: "start-to-end",
        }
      }
    }
  }
  if (params.endPcbPortId !== undefined) {
    for (const route of params.hdRoutes) {
      if (route.startPcbPortId === params.endPcbPortId) {
        return {
          route,
          routePoint: route.route[0]!,
          orientation: "end-to-start",
        }
      }
      if (route.endPcbPortId === params.endPcbPortId) {
        return {
          route,
          routePoint: route.route[route.route.length - 1]!,
          orientation: "end-to-start",
        }
      }
    }
  }
  return undefined
}

const getClosestRouteEndpoint = (params: {
  hdRoutes: HighDensityIntraNodeRoute[]
  start: StitchTerminal
  end: StitchTerminal
}): TerminalRouteEndpoint => {
  let bestDistance = Infinity
  let bestRoute = params.hdRoutes[0]!
  let bestOrientation: TerminalRouteEndpoint["orientation"] = "start-to-end"
  for (const route of params.hdRoutes) {
    const firstPoint = route.route[0]!
    const lastPoint = route.route[route.route.length - 1]!
    const startDistance = Math.min(
      distance(params.start, firstPoint),
      distance(params.start, lastPoint),
    )
    const endDistance = Math.min(
      distance(params.end, firstPoint),
      distance(params.end, lastPoint),
    )
    const routeDistance = Math.min(startDistance, endDistance)
    if (
      routeDistance > bestDistance + DISTANCE_TIE_TOLERANCE ||
      (Math.abs(routeDistance - bestDistance) <= DISTANCE_TIE_TOLERANCE &&
        compareRoutes(route, bestRoute) >= 0)
    ) {
      continue
    }
    bestDistance = routeDistance
    bestRoute = route
    bestOrientation =
      endDistance < startDistance - DISTANCE_TIE_TOLERANCE ||
      (Math.abs(endDistance - startDistance) <= DISTANCE_TIE_TOLERANCE &&
        comparePoints(params.end, params.start) < 0)
        ? "end-to-start"
        : "start-to-end"
  }

  const terminal =
    bestOrientation === "start-to-end" ? params.start : params.end
  const firstPoint = bestRoute.route[0]!
  const lastPoint = bestRoute.route[bestRoute.route.length - 1]!
  const firstPointDistance = distance(terminal, firstPoint)
  const lastPointDistance = distance(terminal, lastPoint)
  const routePoint =
    firstPointDistance < lastPointDistance - DISTANCE_TIE_TOLERANCE ||
    (Math.abs(firstPointDistance - lastPointDistance) <=
      DISTANCE_TIE_TOLERANCE &&
      comparePoints(firstPoint, lastPoint) <= 0)
      ? firstPoint
      : lastPoint
  return { route: bestRoute, routePoint, orientation: bestOrientation }
}

export class SingleHighDensityRouteStitchSolver3 extends BaseSolver {
  override getSolverName(): string {
    return "SingleHighDensityRouteStitchSolver3"
  }

  mergedHdRoute!: HighDensityIntraNodeRoute
  remainingHdRoutes: HighDensityIntraNodeRoute[]
  start: StitchTerminal
  end: StitchTerminal
  colorMap: Record<string, string>
  allowedLayerTransitionPointKeys?: Set<string>
  isStitchSegmentClear: IsStitchSegmentClear
  stitchClearanceMode: StitchClearanceMode

  private isPlanarStitchClear(start: Point3, end: Point3): boolean {
    return this.isStitchSegmentClear({
      connectionName: this.mergedHdRoute.connectionName,
      start,
      end,
      traceThickness: this.mergedHdRoute.traceThickness,
    })
  }

  constructor(opts: {
    connectionName: string
    hdRoutes: HighDensityIntraNodeRoute[]
    start: StitchTerminal
    end: StitchTerminal
    colorMap?: Record<string, string>
    defaultTraceThickness?: number
    defaultViaDiameter?: number
    allowedLayerTransitionPointKeys?: Set<string>
    preserveTerminalPcbPortIds?: boolean
    connectionTerminalPcbPortIds?: ReadonlySet<PcbPortId>
    isStitchSegmentClear: IsStitchSegmentClear
    stitchClearanceMode: StitchClearanceMode
  }) {
    super()
    const canonicalHdRoutes = [...opts.hdRoutes].sort(compareRoutes)
    this.remainingHdRoutes = canonicalHdRoutes
    this.colorMap = opts.colorMap ?? {}
    this.allowedLayerTransitionPointKeys = opts.allowedLayerTransitionPointKeys
    this.isStitchSegmentClear = opts.isStitchSegmentClear
    this.stitchClearanceMode = opts.stitchClearanceMode

    if (canonicalHdRoutes.length === 0) {
      this.start = opts.start
      this.end = opts.end
      const traceThickness = opts.defaultTraceThickness ?? 0.15
      const routePoints = [
        { x: opts.start.x, y: opts.start.y, z: opts.start.z },
      ]
      const vias = []

      if (opts.start.z !== opts.end.z) {
        if (
          opts.allowedLayerTransitionPointKeys &&
          !opts.allowedLayerTransitionPointKeys.has(getXyPointKey(opts.start))
        ) {
          this.failed = true
          this.error = `Layer transition at ${getXyPointKey(
            opts.start,
          )} is not allowed`
          return
        }
        routePoints.push({ x: opts.start.x, y: opts.start.y, z: opts.end.z })
        vias.push({ x: opts.start.x, y: opts.start.y })
      }

      const stitchStart = routePoints[routePoints.length - 1]!
      const stitchEnd = { x: opts.end.x, y: opts.end.y, z: opts.end.z }
      const stitchSegment = {
        connectionName: opts.connectionName,
        start: stitchStart,
        end: stitchEnd,
        traceThickness,
      }
      if (
        distance(stitchStart, stitchEnd) > GEOMETRIC_TOLERANCE &&
        !this.isStitchSegmentClear(stitchSegment) &&
        this.stitchClearanceMode === "require_clear"
      ) {
        this.failed = true
        this.error = `Terminal stitch for "${opts.connectionName}" violates copper clearance`
        return
      }
      routePoints.push(stitchEnd)

      this.mergedHdRoute = {
        connectionName: opts.connectionName,
        ...(opts.preserveTerminalPcbPortIds && opts.start.pcb_port_id
          ? { startPcbPortId: opts.start.pcb_port_id }
          : {}),
        ...(opts.preserveTerminalPcbPortIds && opts.end.pcb_port_id
          ? { endPcbPortId: opts.end.pcb_port_id }
          : {}),
        rootConnectionName: canonicalHdRoutes[0]?.rootConnectionName,
        route: routePoints,
        vias,
        jumpers: [],
        viaDiameter: opts.defaultViaDiameter ?? 0.3,
        traceThickness,
      }
      this.solved = true
      return
    }

    const expectedPcbPortIds =
      opts.connectionTerminalPcbPortIds ??
      new Set(
        (opts.preserveTerminalPcbPortIds
          ? [opts.start.pcb_port_id, opts.end.pcb_port_id]
          : []
        ).filter(
          (pcbPortId): pcbPortId is PcbPortId => pcbPortId !== undefined,
        ),
      )
    if (
      opts.preserveTerminalPcbPortIds &&
      opts.start.pcb_port_id &&
      opts.start.pcb_port_id === opts.end.pcb_port_id
    ) {
      throw new Error(
        `SingleHighDensityRouteStitchSolver3 received duplicate PCB terminal "${opts.start.pcb_port_id}" for "${opts.connectionName}"`,
      )
    }

    const taggedPcbPortIds = canonicalHdRoutes
      .flatMap((route) => [route.startPcbPortId, route.endPcbPortId])
      .filter((pcbPortId): pcbPortId is PcbPortId => pcbPortId !== undefined)

    if (opts.preserveTerminalPcbPortIds && expectedPcbPortIds.size > 0) {
      for (const taggedPcbPortId of taggedPcbPortIds) {
        if (!expectedPcbPortIds.has(taggedPcbPortId)) {
          throw new Error(
            `SingleHighDensityRouteStitchSolver3 found unknown PCB terminal "${taggedPcbPortId}" on "${opts.connectionName}"`,
          )
        }
      }
    }

    const firstRouteEndpoint =
      getTerminalRouteEndpoint({
        hdRoutes: canonicalHdRoutes,
        startPcbPortId: opts.start.pcb_port_id,
        endPcbPortId: opts.end.pcb_port_id,
      }) ??
      getClosestRouteEndpoint({
        hdRoutes: canonicalHdRoutes,
        start: opts.start,
        end: opts.end,
      })
    const { route: firstRoute, routePoint: closestFirstRoutePoint } =
      firstRouteEndpoint
    if (firstRouteEndpoint.orientation === "start-to-end") {
      this.start = opts.start
      this.end = opts.end
    } else {
      this.start = opts.end
      this.end = opts.start
    }

    const closestFirstRoutePcbPortId =
      closestFirstRoutePoint === firstRoute.route[0]
        ? firstRoute.startPcbPortId
        : firstRoute.endPcbPortId
    if (
      closestFirstRoutePcbPortId &&
      this.start.pcb_port_id &&
      closestFirstRoutePcbPortId !== this.start.pcb_port_id
    ) {
      throw new Error(
        `SingleHighDensityRouteStitchSolver3 terminal identity disagrees with route orientation for "${opts.connectionName}"`,
      )
    }

    this.mergedHdRoute = {
      connectionName: opts.connectionName,
      ...(opts.preserveTerminalPcbPortIds && this.start.pcb_port_id
        ? { startPcbPortId: this.start.pcb_port_id }
        : {}),
      ...(opts.preserveTerminalPcbPortIds && this.end.pcb_port_id
        ? { endPcbPortId: this.end.pcb_port_id }
        : {}),
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

  getDisjointedRoute() {
    const TOL = GEOMETRIC_TOLERANCE

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
    const endpoint = this.mergedHdRoute.route.at(-1)!
    const reachedTerminal =
      this.mergedHdRoute.endPcbPortId !== undefined &&
      endpoint.z === this.end.z &&
      distance(endpoint, this.end) < GEOMETRIC_TOLERANCE
    // A terminal-to-terminal path is complete here. Following leftover stubs
    // can traverse another via and disconnect the declared terminal layer.
    if (this.remainingHdRoutes.length === 0 || reachedTerminal) {
      const lastMergedPoint =
        this.mergedHdRoute.route[this.mergedHdRoute.route.length - 1]
      const terminalPoint = { ...this.end, z: lastMergedPoint.z }
      const terminalDistance = distance(lastMergedPoint, terminalPoint)

      if (
        terminalDistance > GEOMETRIC_TOLERANCE &&
        terminalDistance <= MAX_TERMINAL_STITCH_GAP_DISTANCE_3
      ) {
        if (
          !this.isPlanarStitchClear(lastMergedPoint, terminalPoint) &&
          this.stitchClearanceMode === "require_clear"
        ) {
          this.failed = true
          this.error = `Terminal stitch for "${this.mergedHdRoute.connectionName}" violates copper clearance`
          return
        }
        this.mergedHdRoute.route.push({
          x: this.end.x,
          y: this.end.y,
          z: lastMergedPoint.z,
        })
      }

      this.solved = true
      return
    }

    const lastMergedPoint =
      this.mergedHdRoute.route[this.mergedHdRoute.route.length - 1]

    let closestRouteIndex = -1
    let matchedOn: "first" | "last" = "first"
    let bestScore = Infinity
    let blockedByCollision = false

    for (let i = 0; i < this.remainingHdRoutes.length; i++) {
      const hdRoute = this.remainingHdRoutes[i]
      const firstPointInCandidate = hdRoute.route[0]
      const lastPointInCandidate = hdRoute.route[hdRoute.route.length - 1]

      const distToFirst = distance(lastMergedPoint, firstPointInCandidate)
      const distToLast = distance(lastMergedPoint, lastPointInCandidate)

      let scoreFirst = Infinity
      if (lastMergedPoint.z === firstPointInCandidate.z) {
        if (distToFirst < GEOMETRIC_TOLERANCE) {
          scoreFirst = distToFirst
        } else if (distToFirst <= MAX_STITCH_GAP_DISTANCE_3) {
          const isClear = this.isPlanarStitchClear(
            lastMergedPoint,
            firstPointInCandidate,
          )
          if (isClear || this.stitchClearanceMode === "prefer_clear") {
            const clearancePenalty = isClear ? 0 : COLLISION_PENALTY
            scoreFirst = GAP_PENALTY + clearancePenalty + distToFirst
          } else {
            blockedByCollision = true
          }
        }
      } else if (
        distToFirst < GEOMETRIC_TOLERANCE &&
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
        if (distToLast < GEOMETRIC_TOLERANCE) {
          scoreLast = distToLast
        } else if (distToLast <= MAX_STITCH_GAP_DISTANCE_3) {
          const isClear = this.isPlanarStitchClear(
            lastMergedPoint,
            lastPointInCandidate,
          )
          if (isClear || this.stitchClearanceMode === "prefer_clear") {
            const clearancePenalty = isClear ? 0 : COLLISION_PENALTY
            scoreLast = GAP_PENALTY + clearancePenalty + distToLast
          } else {
            blockedByCollision = true
          }
        }
      } else if (
        distToLast < GEOMETRIC_TOLERANCE &&
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
      if (blockedByCollision) {
        this.failed = true
        this.error = `Route stitch for "${this.mergedHdRoute.connectionName}" violates copper clearance`
        return
      }
      this.remainingHdRoutes = []
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

    if (
      pointsToAdd.length > 0 &&
      distance(lastMergedPoint, pointsToAdd[0]) < GEOMETRIC_TOLERANCE &&
      lastMergedPoint.z === pointsToAdd[0].z
    ) {
      if (pointsToAdd[0].toNextSegmentType) {
        lastMergedPoint.toNextSegmentType = pointsToAdd[0].toNextSegmentType
      }
      this.mergedHdRoute.route.push(...pointsToAdd.slice(1))
    } else {
      this.mergedHdRoute.route.push(...pointsToAdd)
    }

    this.mergedHdRoute.vias.push(...hdRouteToMerge.vias)

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
