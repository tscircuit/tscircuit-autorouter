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
} from "./routeStitchingShared"

const VIA_PENALTY = 1000
const GAP_PENALTY = 100000
const GEOMETRIC_TOLERANCE = 1e-3
type RoutePoint = HighDensityIntraNodeRoute["route"][number]
type StitchTerminal = Point3 & { pcb_port_id?: string }
export type StitchSegmentRequest = {
  connectionName: string
  start: Point3
  end: Point3
  traceThickness: number
}
export type IsValidStitchSegment = (params: StitchSegmentRequest) => boolean
export type FindValidStitchPath = (
  params: StitchSegmentRequest,
) => Point3[] | undefined
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
  start: StitchTerminal
  end: StitchTerminal
  colorMap: Record<string, string>
  allowedLayerTransitionPointKeys?: Set<string>
  isValidStitchSegment?: IsValidStitchSegment
  findValidStitchPath?: FindValidStitchPath

  private getPlanarStitchPath(params: StitchSegmentRequest): Point3[] | undefined {
    if (params.start.z !== params.end.z) return undefined
    if (distance(params.start, params.end) < GEOMETRIC_TOLERANCE) {
      return [params.start]
    }
    if (
      !this.isValidStitchSegment ||
      this.isValidStitchSegment(params)
    ) {
      return [params.start, params.end]
    }

    const path = this.findValidStitchPath?.(params)
    if (!path || path.length < 2) return undefined
    if (
      distance(path[0]!, params.start) >= GEOMETRIC_TOLERANCE ||
      distance(path[path.length - 1]!, params.end) >= GEOMETRIC_TOLERANCE
    ) {
      throw new Error("Stitch pathfinder returned a path with wrong endpoints")
    }
    return path
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
    isValidStitchSegment?: IsValidStitchSegment
    findValidStitchPath?: FindValidStitchPath
  }) {
    super()
    const canonicalHdRoutes = [...opts.hdRoutes].sort(compareRoutes)
    this.remainingHdRoutes = canonicalHdRoutes
    this.colorMap = opts.colorMap ?? {}
    this.allowedLayerTransitionPointKeys = opts.allowedLayerTransitionPointKeys
    this.isValidStitchSegment = opts.isValidStitchSegment
    this.findValidStitchPath = opts.findValidStitchPath

    if (canonicalHdRoutes.length === 0) {
      this.start = opts.start
      this.end = opts.end
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
      const planarStart = { ...opts.start, z: opts.end.z }
      const stitchPath = this.getPlanarStitchPath({
        connectionName: opts.connectionName,
        start: planarStart,
        end: opts.end,
        traceThickness: opts.defaultTraceThickness ?? 0.15,
      })
      if (!stitchPath) {
        this.failed = true
        this.error = `Could not route a collision-free direct stitch for "${opts.connectionName}"`
        return
      }
      routePoints.push(
        ...stitchPath.slice(1).map((point) => ({
          x: point.x,
          y: point.y,
          z: point.z,
        })),
      )

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
        traceThickness: opts.defaultTraceThickness ?? 0.15,
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
            `SingleHighDensityRouteStitchSolver3 found unknown PCB terminal "${taggedPcbPortId}" on "${opts.connectionName}"`,
          )
        }
      }
    }

    let bestDist = Infinity
    let firstRoute = canonicalHdRoutes[0]
    let orientation: "start-to-end" | "end-to-start" = "start-to-end"

    for (const route of canonicalHdRoutes) {
      const firstPoint = route.route[0]
      const lastPoint = route.route[route.route.length - 1]

      const getTerminalDistance = (
        terminal: StitchTerminal,
        endpoint: RoutePoint,
      ) => {
        const terminalOnEndpointLayer = { ...terminal, z: endpoint.z }
        if (
          distance(terminalOnEndpointLayer, endpoint) >
          MAX_TERMINAL_STITCH_GAP_DISTANCE_3
        ) {
          return Infinity
        }
        const path = this.getPlanarStitchPath({
          connectionName: opts.connectionName,
          start: terminalOnEndpointLayer,
          end: endpoint,
          traceThickness: route.traceThickness,
        })
        if (!path) return Infinity

        let pathLength = Math.abs(terminal.z - endpoint.z)
        for (let index = 0; index < path.length - 1; index += 1) {
          pathLength += distance(path[index]!, path[index + 1]!)
        }
        return pathLength
      }
      const distStartToFirst = getTerminalDistance(opts.start, firstPoint)
      const distStartToLast = getTerminalDistance(opts.start, lastPoint)
      const distEndToFirst = getTerminalDistance(opts.end, firstPoint)
      const distEndToLast = getTerminalDistance(opts.end, lastPoint)

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

    if (!Number.isFinite(bestDist)) {
      this.start = opts.start
      this.end = opts.end
      this.failed = true
      this.error = `No collision-free terminal stitch segment for "${opts.connectionName}"`
      return
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
    const getFirstRouteEndpointDistance = (endpoint: RoutePoint) => {
      const startOnEndpointLayer = { ...this.start, z: endpoint.z }
      if (
        distance(startOnEndpointLayer, endpoint) >
        MAX_TERMINAL_STITCH_GAP_DISTANCE_3
      ) {
        return Infinity
      }
      const path = this.getPlanarStitchPath({
        connectionName: opts.connectionName,
        start: startOnEndpointLayer,
        end: endpoint,
        traceThickness: firstRoute.traceThickness,
      })
      if (!path) return Infinity

      let pathLength = Math.abs(this.start.z - endpoint.z)
      for (let index = 0; index < path.length - 1; index += 1) {
        pathLength += distance(path[index]!, path[index + 1]!)
      }
      return pathLength
    }
    const distToFirst = getFirstRouteEndpointDistance(firstRouteFirstPoint)
    const distToLast = getFirstRouteEndpointDistance(firstRouteLastPoint)
    const closestFirstRoutePoint =
      distToFirst < distToLast - DISTANCE_TIE_TOLERANCE ||
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
    if (this.remainingHdRoutes.length === 0) {
      const lastMergedPoint =
        this.mergedHdRoute.route[this.mergedHdRoute.route.length - 1]

      if (
        distance(lastMergedPoint, this.end) > GEOMETRIC_TOLERANCE &&
        distance(lastMergedPoint, this.end) <=
          MAX_TERMINAL_STITCH_GAP_DISTANCE_3
      ) {
        const endOnMergedLayer = { ...this.end, z: lastMergedPoint.z }
        const terminalPath = this.getPlanarStitchPath({
          connectionName: this.mergedHdRoute.connectionName,
          start: lastMergedPoint,
          end: endOnMergedLayer,
          traceThickness: this.mergedHdRoute.traceThickness,
        })
        if (!terminalPath) {
          this.failed = true
          this.error = `Could not route a collision-free terminal stitch for "${this.mergedHdRoute.connectionName}"`
          return
        }
        this.mergedHdRoute.route.push(
          ...terminalPath.slice(1).map((point) => ({
            x: point.x,
            y: point.y,
            z: point.z,
          })),
        )
      } else if (
        this.isValidStitchSegment &&
        distance(lastMergedPoint, this.end) > GEOMETRIC_TOLERANCE
      ) {
        this.failed = true
        this.error = `Stitched route "${this.mergedHdRoute.connectionName}" does not reach its terminal`
        return
      }

      this.solved = true
      return
    }

    const lastMergedPoint =
      this.mergedHdRoute.route[this.mergedHdRoute.route.length - 1]

    let closestRouteIndex = -1
    let matchedOn: "first" | "last" = "first"
    let bestScore = Infinity
    let bestStitchPath: Point3[] | undefined

    type StitchCandidate = {
      routeIndex: number
      matchedOn: "first" | "last"
      endpoint: RoutePoint
      lowerBoundScore: number
      needsPlanarPath: boolean
    }
    const candidates: StitchCandidate[] = []

    for (let i = 0; i < this.remainingHdRoutes.length; i++) {
      const hdRoute = this.remainingHdRoutes[i]
      const firstPointInCandidate = hdRoute.route[0]
      const lastPointInCandidate = hdRoute.route[hdRoute.route.length - 1]

      const distToFirst = distance(lastMergedPoint, firstPointInCandidate)
      const distToLast = distance(lastMergedPoint, lastPointInCandidate)

      if (lastMergedPoint.z === firstPointInCandidate.z) {
        if (distToFirst < GEOMETRIC_TOLERANCE) {
          candidates.push({
            routeIndex: i,
            matchedOn: "first",
            endpoint: firstPointInCandidate,
            lowerBoundScore: distToFirst,
            needsPlanarPath: false,
          })
        } else if (distToFirst <= MAX_STITCH_GAP_DISTANCE_3) {
          candidates.push({
            routeIndex: i,
            matchedOn: "first",
            endpoint: firstPointInCandidate,
            lowerBoundScore: GAP_PENALTY + distToFirst,
            needsPlanarPath: true,
          })
        }
      } else if (
        distToFirst < GEOMETRIC_TOLERANCE &&
        (!this.allowedLayerTransitionPointKeys ||
          this.allowedLayerTransitionPointKeys.has(
            getXyPointKey(firstPointInCandidate),
          ))
      ) {
        candidates.push({
          routeIndex: i,
          matchedOn: "first",
          endpoint: firstPointInCandidate,
          lowerBoundScore: VIA_PENALTY + distToFirst,
          needsPlanarPath: false,
        })
      }

      if (lastMergedPoint.z === lastPointInCandidate.z) {
        if (distToLast < GEOMETRIC_TOLERANCE) {
          candidates.push({
            routeIndex: i,
            matchedOn: "last",
            endpoint: lastPointInCandidate,
            lowerBoundScore: distToLast,
            needsPlanarPath: false,
          })
        } else if (distToLast <= MAX_STITCH_GAP_DISTANCE_3) {
          candidates.push({
            routeIndex: i,
            matchedOn: "last",
            endpoint: lastPointInCandidate,
            lowerBoundScore: GAP_PENALTY + distToLast,
            needsPlanarPath: true,
          })
        }
      } else if (
        distToLast < GEOMETRIC_TOLERANCE &&
        (!this.allowedLayerTransitionPointKeys ||
          this.allowedLayerTransitionPointKeys.has(
            getXyPointKey(lastPointInCandidate),
          ))
      ) {
        candidates.push({
          routeIndex: i,
          matchedOn: "last",
          endpoint: lastPointInCandidate,
          lowerBoundScore: VIA_PENALTY + distToLast,
          needsPlanarPath: false,
        })
      }
    }

    candidates.sort(
      (a, b) =>
        a.lowerBoundScore - b.lowerBoundScore ||
        a.routeIndex - b.routeIndex ||
        (a.matchedOn === b.matchedOn
          ? 0
          : a.matchedOn === "first"
            ? -1
            : 1),
    )

    for (const candidate of candidates) {
      if (candidate.lowerBoundScore >= bestScore) break
      let score = candidate.lowerBoundScore
      let stitchPath: Point3[] | undefined
      if (candidate.needsPlanarPath) {
        stitchPath = this.getPlanarStitchPath({
          connectionName: this.mergedHdRoute.connectionName,
          start: lastMergedPoint,
          end: candidate.endpoint,
          traceThickness: this.mergedHdRoute.traceThickness,
        })
        if (!stitchPath) continue
        let pathLength = 0
        for (let index = 0; index < stitchPath.length - 1; index += 1) {
          pathLength += distance(stitchPath[index]!, stitchPath[index + 1]!)
        }
        score = GAP_PENALTY + pathLength
      }
      if (score >= bestScore) continue
      bestScore = score
      closestRouteIndex = candidate.routeIndex
      matchedOn = candidate.matchedOn
      bestStitchPath = stitchPath
    }

    if (closestRouteIndex === -1) {
      if (this.isValidStitchSegment) {
        this.failed = true
        this.error = `No collision-free stitch continuation for "${this.mergedHdRoute.connectionName}"`
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

    if (bestStitchPath && bestStitchPath.length > 2) {
      this.mergedHdRoute.route.push(
        ...bestStitchPath.slice(1, -1).map((point) => ({
          x: point.x,
          y: point.y,
          z: point.z,
        })),
      )
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
