import { distance, type Point3 } from "@tscircuit/math-utils"
import { GraphicsObject } from "graphics-debug"
import { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import { BaseSolver } from "../BaseSolver"
import type { StitchTerminal } from "./getStitchTerminal"
import { getRouteStitchOrientation } from "./getRouteStitchOrientation"
import type { IsStitchSegmentClear } from "./route-stitch-clearance-validator"
import type { OrderedRouteStitchEntry } from "./routeStitchingEndpointHelpers"
import {
  comparePoints,
  compareRoutes,
  DISTANCE_TIE_TOLERANCE,
  GEOMETRIC_STITCH_TOLERANCE as GEOMETRIC_TOLERANCE,
  MAX_STITCH_GAP_DISTANCE_3,
  MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
} from "./routeStitchingShared"

const VIA_PENALTY = 1000
const GAP_PENALTY = 100000
const COLLISION_PENALTY = MAX_STITCH_GAP_DISTANCE_3 + DISTANCE_TIE_TOLERANCE
type RoutePoint = HighDensityIntraNodeRoute["route"][number]
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

export class SingleHighDensityRouteStitchSolver3 extends BaseSolver {
  override getSolverName(): string {
    return "SingleHighDensityRouteStitchSolver3"
  }

  mergedHdRoute!: HighDensityIntraNodeRoute
  remainingHdRoutes: HighDensityIntraNodeRoute[]
  private remainingOrderedRoutePath?: OrderedRouteStitchEntry[]
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

  private hasExistingTerminalVia(
    transitionStart: Point3,
    transitionEnd: Point3,
    route: HighDensityIntraNodeRoute,
    orientation: "forward" | "reverse",
  ): boolean {
    if (
      this.allowedLayerTransitionPointKeys &&
      !this.allowedLayerTransitionPointKeys.has(getXyPointKey(transitionStart))
    ) {
      return false
    }
    if (
      route.viaDiameter !== this.mergedHdRoute.viaDiameter ||
      !route.vias.some(
        (via): boolean =>
          via.x === transitionStart.x && via.y === transitionStart.y,
      )
    ) {
      return false
    }
    // Public materialization identifies vias by their directed layer pair.
    // A reversed or partial-span traversal would create another overlapping
    // via element, so reuse only the exact already represented transition.
    const fromZ =
      orientation === "forward" ? transitionStart.z : transitionEnd.z
    const toZ = orientation === "forward" ? transitionEnd.z : transitionStart.z
    for (let index = 0; index < route.route.length - 1; index += 1) {
      const start = route.route[index]!
      const end = route.route[index + 1]!
      if (
        start.toNextSegmentType !== "through_obstacle" &&
        start.x === transitionStart.x &&
        start.y === transitionStart.y &&
        end.x === transitionEnd.x &&
        end.y === transitionEnd.y &&
        start.x === end.x &&
        start.y === end.y &&
        start.z !== end.z &&
        start.z === fromZ &&
        end.z === toZ
      ) {
        return true
      }
    }
    return false
  }

  constructor(opts: {
    connectionName: string
    hdRoutes: HighDensityIntraNodeRoute[]
    orderedRoutePath?: OrderedRouteStitchEntry[]
    start: StitchTerminal
    end: StitchTerminal
    colorMap?: Record<string, string>
    defaultTraceThickness?: number
    defaultViaDiameter?: number
    allowedLayerTransitionPointKeys?: Set<string>
    preserveTerminalPcbPortIds?: boolean
    isStitchSegmentClear: IsStitchSegmentClear
    stitchClearanceMode: StitchClearanceMode
  }) {
    super()
    if (opts.orderedRoutePath) {
      const pathRouteSet = new Set(
        opts.orderedRoutePath.map(
          (entry): HighDensityIntraNodeRoute => entry.route,
        ),
      )
      if (
        opts.orderedRoutePath.length !== opts.hdRoutes.length ||
        pathRouteSet.size !== opts.hdRoutes.length ||
        opts.hdRoutes.some((route): boolean => !pathRouteSet.has(route))
      ) {
        throw new Error(
          `Ordered stitching path for "${opts.connectionName}" does not match its input routes`,
        )
      }
      this.remainingOrderedRoutePath = [...opts.orderedRoutePath]
    }
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
      const startLayers = opts.start.availableZ ?? [opts.start.z]
      const endLayers = opts.end.availableZ ?? [opts.end.z]
      const commonLayer = startLayers.find((z): boolean =>
        endLayers.includes(z),
      )
      if (commonLayer === undefined) {
        this.failed = true
        this.error = `Terminal stitch for "${opts.connectionName}" requires an existing via between terminal layers`
        return
      }
      const routePoints = [{ x: opts.start.x, y: opts.start.y, z: commonLayer }]
      const vias: HighDensityIntraNodeRoute["vias"] = []

      const stitchStart = routePoints[routePoints.length - 1]!
      const stitchEnd = { x: opts.end.x, y: opts.end.y, z: commonLayer }
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

    const expectedPcbPortIds = new Set(
      (opts.preserveTerminalPcbPortIds
        ? [opts.start.pcb_port_id, opts.end.pcb_port_id]
        : []
      ).filter((pcbPortId): pcbPortId is string => pcbPortId !== undefined),
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
      .filter((pcbPortId): pcbPortId is string => pcbPortId !== undefined)

    if (expectedPcbPortIds.size > 0) {
      for (const taggedPcbPortId of taggedPcbPortIds) {
        if (!expectedPcbPortIds.has(taggedPcbPortId)) {
          throw new Error(
            `SingleHighDensityRouteStitchSolver3 found unknown PCB terminal "${taggedPcbPortId}" on "${opts.connectionName}": ${JSON.stringify(
              {
                start: opts.start,
                end: opts.end,
                expectedPcbPortIds: [...expectedPcbPortIds],
                offendingRoutes: canonicalHdRoutes.filter(
                  (route): boolean =>
                    route.startPcbPortId === taggedPcbPortId ||
                    route.endPcbPortId === taggedPcbPortId,
                ),
                orderedRoutePath: opts.orderedRoutePath,
              },
            )}`,
          )
        }
      }
    }

    let { firstRoute, orientation } = getRouteStitchOrientation({
      hdRoutes: canonicalHdRoutes,
      start: opts.start,
      end: opts.end,
    })

    if (this.remainingOrderedRoutePath && orientation === "end-to-start") {
      this.remainingOrderedRoutePath = [...this.remainingOrderedRoutePath]
        .reverse()
        .map(
          (entry): OrderedRouteStitchEntry => ({
            route: entry.route,
            matchedOn: entry.matchedOn === "first" ? "last" : "first",
          }),
        )
    }
    const firstPathEntry = this.remainingOrderedRoutePath?.[0]
    if (firstPathEntry) {
      firstRoute = firstPathEntry.route
    }

    if (orientation === "start-to-end") {
      this.start = opts.start
      this.end = opts.end
    } else {
      this.start = opts.end
      this.end = opts.start
    }

    const firstRouteFirstPoint = firstRoute.route[0]
    const firstRouteLastPoint = firstRoute.route[firstRoute.route.length - 1]
    const distToFirst = distance(this.start, firstRouteFirstPoint)
    const distToLast = distance(this.start, firstRouteLastPoint)
    const closestFirstRoutePoint = firstPathEntry
      ? firstPathEntry.matchedOn === "first"
        ? firstRouteFirstPoint
        : firstRouteLastPoint
      : distToFirst < distToLast - DISTANCE_TIE_TOLERANCE ||
          (Math.abs(distToFirst - distToLast) <= DISTANCE_TIE_TOLERANCE &&
            comparePoints(firstRouteFirstPoint, firstRouteLastPoint) <= 0)
        ? firstRouteFirstPoint
        : firstRouteLastPoint
    const closestFirstRoutePcbPortId =
      closestFirstRoutePoint === firstRouteFirstPoint
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
          z: this.start.availableZ?.includes(closestFirstRoutePoint.z)
            ? closestFirstRoutePoint.z
            : this.start.z,
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

  _step(): void {
    if (this.remainingHdRoutes.length === 0) {
      const lastMergedPoint =
        this.mergedHdRoute.route[this.mergedHdRoute.route.length - 1]
      const terminalZ = this.end.availableZ?.includes(lastMergedPoint.z)
        ? lastMergedPoint.z
        : this.end.z
      const requiresTerminalVia = lastMergedPoint.z !== terminalZ
      const terminalPoint = {
        x: this.end.x,
        y: this.end.y,
        z: lastMergedPoint.z,
      }
      const terminalDistance = distance(lastMergedPoint, terminalPoint)

      if (
        requiresTerminalVia &&
        (terminalDistance > MAX_TERMINAL_STITCH_GAP_DISTANCE_3 ||
          !this.hasExistingTerminalVia(
            terminalPoint,
            this.end,
            this.mergedHdRoute,
            "forward",
          ))
      ) {
        this.failed = true
        this.error = `Terminal stitch for "${this.mergedHdRoute.connectionName}" cannot reach terminal layer ${terminalZ} without an existing allowed via`
        return
      }

      if (
        (terminalDistance > GEOMETRIC_TOLERANCE ||
          (requiresTerminalVia && terminalDistance > 0)) &&
        terminalDistance <= MAX_TERMINAL_STITCH_GAP_DISTANCE_3
      ) {
        if (
          !this.isPlanarStitchClear(lastMergedPoint, terminalPoint) &&
          (requiresTerminalVia || this.stitchClearanceMode === "require_clear")
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

      if (requiresTerminalVia) {
        this.mergedHdRoute.route.push({
          x: this.end.x,
          y: this.end.y,
          z: terminalZ,
        })
      }

      this.solved = true
      return
    }

    const lastMergedPoint =
      this.mergedHdRoute.route[this.mergedHdRoute.route.length - 1]
    const startsAtTerminal = this.mergedHdRoute.route.length === 1
    const nextPathEntry = this.remainingOrderedRoutePath?.[0]

    let closestRouteIndex = -1
    let matchedOn: "first" | "last" = "first"
    let bestScore = Infinity
    let blockedByCollision = false

    for (let i = 0; i < this.remainingHdRoutes.length; i++) {
      const hdRoute = this.remainingHdRoutes[i]
      if (nextPathEntry && hdRoute !== nextPathEntry.route) continue
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
        (!startsAtTerminal ||
          (lastMergedPoint.x === firstPointInCandidate.x &&
            lastMergedPoint.y === firstPointInCandidate.y &&
            this.hasExistingTerminalVia(
              lastMergedPoint,
              firstPointInCandidate,
              hdRoute,
              "forward",
            ))) &&
        (!this.allowedLayerTransitionPointKeys ||
          this.allowedLayerTransitionPointKeys.has(
            getXyPointKey(firstPointInCandidate),
          ))
      ) {
        scoreFirst = VIA_PENALTY + distToFirst
      }

      if (
        (!nextPathEntry || nextPathEntry.matchedOn === "first") &&
        scoreFirst < bestScore
      ) {
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
        (!startsAtTerminal ||
          (lastMergedPoint.x === lastPointInCandidate.x &&
            lastMergedPoint.y === lastPointInCandidate.y &&
            this.hasExistingTerminalVia(
              lastMergedPoint,
              lastPointInCandidate,
              hdRoute,
              "reverse",
            ))) &&
        (!this.allowedLayerTransitionPointKeys ||
          this.allowedLayerTransitionPointKeys.has(
            getXyPointKey(lastPointInCandidate),
          ))
      ) {
        scoreLast = VIA_PENALTY + distToLast
      }

      if (
        (!nextPathEntry || nextPathEntry.matchedOn === "last") &&
        scoreLast < bestScore
      ) {
        bestScore = scoreLast
        closestRouteIndex = i
        matchedOn = "last"
      }
    }

    if (closestRouteIndex === -1) {
      if (nextPathEntry) {
        this.failed = true
        this.error = `Ordered route stitch for "${this.mergedHdRoute.connectionName}" cannot follow its selected endpoint path`
        return
      }
      if (blockedByCollision) {
        this.failed = true
        this.error = `Route stitch for "${this.mergedHdRoute.connectionName}" violates copper clearance`
        return
      }
      if (startsAtTerminal) {
        this.failed = true
        this.error = `Route stitch for "${this.mergedHdRoute.connectionName}" cannot leave terminal layer ${lastMergedPoint.z} without an existing allowed via`
        return
      }
      this.remainingHdRoutes = []
      return
    }

    const hdRouteToMerge = this.remainingHdRoutes[closestRouteIndex]
    this.remainingHdRoutes.splice(closestRouteIndex, 1)
    if (nextPathEntry) this.remainingOrderedRoutePath!.shift()

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
