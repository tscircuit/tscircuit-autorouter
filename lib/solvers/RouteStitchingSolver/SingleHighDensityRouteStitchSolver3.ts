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
type RetreatAnchor = {
  point: RoutePoint
  trimCount: number
  retreatDistance: number
  isVirtual: boolean
}
type PlanarStitchPlan = {
  path: Point3[]
  mergedAnchor: RetreatAnchor
  candidateAnchor?: RetreatAnchor
  retreatDistance: number
}
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
export type IsTerminalCoveredByTrace = (params: {
  connectionName: string
  routeEnd: Point3
  terminal: StitchTerminal
  traceThickness: number
}) => boolean
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
  isTerminalCoveredByTrace?: IsTerminalCoveredByTrace

  private getPlanarStitchPath(
    params: StitchSegmentRequest,
  ): Point3[] | undefined {
    if (params.start.z !== params.end.z) return undefined
    if (distance(params.start, params.end) < GEOMETRIC_TOLERANCE) {
      return [params.start]
    }
    if (!this.isValidStitchSegment || this.isValidStitchSegment(params)) {
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

  private getPathLength(path: Point3[]): number {
    let pathLength = 0
    for (let index = 0; index < path.length - 1; index += 1) {
      pathLength += distance(path[index]!, path[index + 1]!)
    }
    return pathLength
  }

  private getRetreatSampleDistances(maxRetreatDistance: number): number[] {
    const sampleDistances: number[] = []
    for (
      let sampleDistance = maxRetreatDistance;
      sampleDistance > GEOMETRIC_TOLERANCE;
      sampleDistance /= 2
    ) {
      sampleDistances.push(sampleDistance)
    }
    return sampleDistances.reverse()
  }

  private interpolateRoutePoint(
    start: RoutePoint,
    end: RoutePoint,
    ratio: number,
  ): RoutePoint {
    return {
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
      z: start.z,
    }
  }

  private isTerminalLocation(point: Point3): boolean {
    const startOnPointLayer = { ...this.start, z: point.z }
    const endOnPointLayer = { ...this.end, z: point.z }
    return (
      distance(point, startOnPointLayer) < GEOMETRIC_TOLERANCE ||
      distance(point, endOnPointLayer) < GEOMETRIC_TOLERANCE
    )
  }

  private isUntaggedTerminalCoveredByTrace(
    routeEnd: RoutePoint,
    terminal: StitchTerminal,
  ): boolean {
    if (terminal.pcb_port_id || routeEnd.z !== terminal.z) return false
    const traceRadius =
      (routeEnd.traceThickness ?? this.mergedHdRoute.traceThickness) / 2
    return distance(routeEnd, terminal) <= traceRadius + GEOMETRIC_TOLERANCE
  }

  private isTerminalReachedByCopper(routeEnd: RoutePoint): boolean {
    if (routeEnd.z !== this.end.z) return false
    if (distance(routeEnd, this.end) < GEOMETRIC_TOLERANCE) return true
    if (this.isUntaggedTerminalCoveredByTrace(routeEnd, this.end)) return true
    return Boolean(
      this.isTerminalCoveredByTrace?.({
        connectionName: this.mergedHdRoute.connectionName,
        routeEnd,
        terminal: this.end,
        traceThickness:
          routeEnd.traceThickness ?? this.mergedHdRoute.traceThickness,
      }),
    )
  }

  /**
   * Returns progressively earlier anchors on the current planar tail. A layer
   * transition, protected terminal, or through-obstacle segment is a hard
   * boundary: local stitch repair must not rewrite any of those structures.
   */
  private getTailRetreatAnchors(
    points: RoutePoint[],
    maxRetreatDistance: number,
  ): RetreatAnchor[] {
    const endpoint = points[points.length - 1]!
    return this.getPrefixRetreatAnchors(
      reverseRoutePoints(points),
      maxRetreatDistance,
      this.isTerminalLocation(endpoint),
      (point) => this.isTerminalLocation(point),
    )
  }

  /** Same as getTailRetreatAnchors, but for an oriented candidate prefix. */
  private getPrefixRetreatAnchors(
    points: RoutePoint[],
    maxRetreatDistance: number,
    endpointIsProtected: boolean,
    isProtectedPoint?: (point: RoutePoint) => boolean,
  ): RetreatAnchor[] {
    const anchors: RetreatAnchor[] = [
      {
        point: points[0]!,
        trimCount: 0,
        retreatDistance: 0,
        isVirtual: false,
      },
    ]
    if (endpointIsProtected) return anchors

    const sampleDistances = this.getRetreatSampleDistances(maxRetreatDistance)
    let retreatDistance = 0
    for (let index = 1; index < points.length; index += 1) {
      const removedPoint = points[index - 1]!
      const anchor = points[index]!
      if (removedPoint.z !== anchor.z) break
      if (
        removedPoint.toNextSegmentType ||
        removedPoint.pcb_port_id ||
        isProtectedPoint?.(removedPoint)
      ) {
        break
      }

      const segmentLength = distance(removedPoint, anchor)
      const segmentEndDistance = retreatDistance + segmentLength
      for (const sampleDistance of sampleDistances) {
        if (sampleDistance <= retreatDistance + GEOMETRIC_TOLERANCE) continue
        if (sampleDistance >= segmentEndDistance - GEOMETRIC_TOLERANCE) {
          continue
        }
        anchors.push({
          point: this.interpolateRoutePoint(
            removedPoint,
            anchor,
            (sampleDistance - retreatDistance) / segmentLength,
          ),
          trimCount: index,
          retreatDistance: sampleDistance,
          isVirtual: true,
        })
      }

      retreatDistance = segmentEndDistance
      if (retreatDistance > maxRetreatDistance + GEOMETRIC_TOLERANCE) break
      anchors.push({
        point: anchor,
        trimCount: index,
        retreatDistance,
        isVirtual: false,
      })
    }

    return anchors.sort((a, b) => a.retreatDistance - b.retreatDistance)
  }

  private getRetreatedPlanarStitchPlan(params: {
    candidatePoints: RoutePoint[]
    candidateEndpointIsProtected: boolean
  }): PlanarStitchPlan | undefined {
    const mergedAnchors = this.getTailRetreatAnchors(
      this.mergedHdRoute.route,
      MAX_STITCH_GAP_DISTANCE_3,
    )
    const candidateAnchors = this.getPrefixRetreatAnchors(
      params.candidatePoints,
      MAX_STITCH_GAP_DISTANCE_3,
      params.candidateEndpointIsProtected,
    )

    let bestPlan: PlanarStitchPlan | undefined
    let bestCost = Infinity
    for (const mergedAnchor of mergedAnchors) {
      for (const candidateAnchor of candidateAnchors) {
        if (mergedAnchor.trimCount === 0 && candidateAnchor.trimCount === 0) {
          continue
        }
        if (mergedAnchor.point.z !== candidateAnchor.point.z) continue

        const retreatDistance =
          mergedAnchor.retreatDistance + candidateAnchor.retreatDistance
        if (retreatDistance >= bestCost) continue
        const path = this.getPlanarStitchPath({
          connectionName: this.mergedHdRoute.connectionName,
          start: mergedAnchor.point,
          end: candidateAnchor.point,
          traceThickness: this.mergedHdRoute.traceThickness,
        })
        if (!path) continue

        const cost = retreatDistance + this.getPathLength(path)
        if (cost >= bestCost - DISTANCE_TIE_TOLERANCE) continue
        bestCost = cost
        bestPlan = {
          path,
          mergedAnchor,
          candidateAnchor,
          retreatDistance,
        }
      }
    }

    return bestPlan
  }

  private getRetreatedTerminalStitchPlan(
    terminalOnMergedLayer: Point3,
  ): PlanarStitchPlan | undefined {
    const mergedAnchors = this.getTailRetreatAnchors(
      this.mergedHdRoute.route,
      MAX_STITCH_GAP_DISTANCE_3,
    )
    let bestPlan: PlanarStitchPlan | undefined
    let bestCost = Infinity

    for (const mergedAnchor of mergedAnchors.slice(1)) {
      const path = this.getPlanarStitchPath({
        connectionName: this.mergedHdRoute.connectionName,
        start: mergedAnchor.point,
        end: terminalOnMergedLayer,
        traceThickness: this.mergedHdRoute.traceThickness,
      })
      if (!path) continue

      const cost = mergedAnchor.retreatDistance + this.getPathLength(path)
      if (cost >= bestCost - DISTANCE_TIE_TOLERANCE) continue
      bestCost = cost
      bestPlan = {
        path,
        mergedAnchor,
        retreatDistance: mergedAnchor.retreatDistance,
      }
    }

    return bestPlan
  }

  private tryCompleteTerminalStitch(lastMergedPoint: RoutePoint): boolean {
    if (this.isTerminalReachedByCopper(lastMergedPoint)) return true

    const endOnMergedLayer = { ...this.end, z: lastMergedPoint.z }
    const planarTerminalDistance = distance(lastMergedPoint, endOnMergedLayer)
    const needsLayerTransition = lastMergedPoint.z !== this.end.z
    if (
      needsLayerTransition &&
      this.allowedLayerTransitionPointKeys &&
      !this.allowedLayerTransitionPointKeys.has(getXyPointKey(this.end))
    ) {
      return false
    }
    if (
      !this.isValidStitchSegment &&
      planarTerminalDistance > MAX_TERMINAL_STITCH_GAP_DISTANCE_3
    ) {
      return false
    }

    const directTerminalPath = this.getPlanarStitchPath({
      connectionName: this.mergedHdRoute.connectionName,
      start: lastMergedPoint,
      end: endOnMergedLayer,
      traceThickness: this.mergedHdRoute.traceThickness,
    })
    const terminalPlan = directTerminalPath
      ? {
          path: directTerminalPath,
          mergedAnchor: {
            point: lastMergedPoint,
            trimCount: 0,
            retreatDistance: 0,
            isVirtual: false,
          },
          retreatDistance: 0,
        }
      : this.getRetreatedTerminalStitchPlan(endOnMergedLayer)

    if (!terminalPlan) return false
    this.applyMergedRetreat(terminalPlan.mergedAnchor)
    this.mergedHdRoute.route.push(
      ...terminalPlan.path.slice(1).map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z,
      })),
    )
    if (needsLayerTransition) {
      this.mergedHdRoute.route.push({
        x: this.end.x,
        y: this.end.y,
        z: this.end.z,
      })
      if (
        !this.mergedHdRoute.vias.some(
          (via) => distance(via, this.end) < GEOMETRIC_TOLERANCE,
        )
      ) {
        this.mergedHdRoute.vias.push({ x: this.end.x, y: this.end.y })
      }
    }
    return true
  }

  private clearLastSegmentMetadata() {
    const lastIndex = this.mergedHdRoute.route.length - 1
    const lastPoint = this.mergedHdRoute.route[lastIndex]!
    if (!lastPoint.toNextSegmentType) return
    const { toNextSegmentType: _removedSegmentType, ...anchor } = lastPoint
    this.mergedHdRoute.route[lastIndex] = anchor
  }

  private applyMergedRetreat(anchor: RetreatAnchor) {
    if (anchor.trimCount === 0) return
    this.mergedHdRoute.route.splice(-anchor.trimCount, anchor.trimCount)
    this.clearLastSegmentMetadata()
    if (anchor.isVirtual) {
      this.mergedHdRoute.route.push({ ...anchor.point })
    }
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
    isTerminalCoveredByTrace?: IsTerminalCoveredByTrace
  }) {
    super()
    const canonicalHdRoutes = [...opts.hdRoutes].sort(compareRoutes)
    this.remainingHdRoutes = canonicalHdRoutes
    this.colorMap = opts.colorMap ?? {}
    this.allowedLayerTransitionPointKeys = opts.allowedLayerTransitionPointKeys
    this.isValidStitchSegment = opts.isValidStitchSegment
    this.findValidStitchPath = opts.findValidStitchPath
    this.isTerminalCoveredByTrace = opts.isTerminalCoveredByTrace

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

      if (this.tryCompleteTerminalStitch(lastMergedPoint)) {
        this.solved = true
        return
      }

      if (this.isValidStitchSegment) {
        this.failed = true
        const terminalDistance = distance(lastMergedPoint, this.end)
        this.error =
          terminalDistance <= MAX_TERMINAL_STITCH_GAP_DISTANCE_3
            ? `Could not route a collision-free terminal stitch for "${this.mergedHdRoute.connectionName}"`
            : `Stitched route "${this.mergedHdRoute.connectionName}" does not reach its terminal`
        return
      }

      this.solved = true
      return
    }

    const lastMergedPoint =
      this.mergedHdRoute.route[this.mergedHdRoute.route.length - 1]

    // A two-terminal route is complete as soon as its copper reaches the end
    // terminal. Continuing from there can only append a same-root branch that
    // belongs to another terminal path and may strand this route on its layer.
    if (this.isTerminalReachedByCopper(lastMergedPoint)) {
      this.remainingHdRoutes = []
      this.solved = true
      return
    }

    let closestRouteIndex = -1
    let matchedOn: "first" | "last" = "first"
    let bestScore = Infinity
    let bestStitchPath: Point3[] | undefined
    let bestMergedRetreatAnchor: RetreatAnchor | undefined
    let bestCandidateRetreatAnchor: RetreatAnchor | undefined
    let bestOverlapJoinPoint: Point3 | undefined
    let bestStrandsLayer = true

    type StitchCandidate = {
      routeIndex: number
      matchedOn: "first" | "last"
      endpoint: RoutePoint
      lowerBoundScore: number
      needsPlanarPath: boolean
      overlapJoinPoint?: Point3
    }
    const candidates: StitchCandidate[] = []
    const canConsiderPlanarGap = (gapDistance: number) =>
      Boolean(this.isValidStitchSegment) ||
      gapDistance <= MAX_STITCH_GAP_DISTANCE_3
    const mergedPreviousPoint =
      this.mergedHdRoute.route[this.mergedHdRoute.route.length - 2]
    const mergedEndpointIsMovable = Boolean(
      mergedPreviousPoint &&
        mergedPreviousPoint.z === lastMergedPoint.z &&
        !mergedPreviousPoint.toNextSegmentType &&
        !lastMergedPoint.pcb_port_id &&
        !this.isTerminalLocation(lastMergedPoint) &&
        !this.mergedHdRoute.vias.some(
          (via) => distance(via, lastMergedPoint) < GEOMETRIC_TOLERANCE,
        ),
    )

    const getOverlapJoinPoint = (
      hdRoute: HighDensityIntraNodeRoute,
      endpoint: RoutePoint,
      endpointIsMovable: boolean,
    ): Point3 | undefined => {
      if (!mergedEndpointIsMovable || !endpointIsMovable) return undefined
      const endpointDistance = distance(lastMergedPoint, endpoint)
      const mergedRadius =
        (lastMergedPoint.traceThickness ?? this.mergedHdRoute.traceThickness) /
        2
      const candidateRadius =
        (endpoint.traceThickness ?? hdRoute.traceThickness) / 2
      const combinedRadius = mergedRadius + candidateRadius
      if (endpointDistance > combinedRadius + GEOMETRIC_TOLERANCE) {
        return undefined
      }
      const mergedShare = mergedRadius / combinedRadius
      return {
        x: lastMergedPoint.x + (endpoint.x - lastMergedPoint.x) * mergedShare,
        y: lastMergedPoint.y + (endpoint.y - lastMergedPoint.y) * mergedShare,
        z: lastMergedPoint.z,
      }
    }

    for (let i = 0; i < this.remainingHdRoutes.length; i++) {
      const hdRoute = this.remainingHdRoutes[i]
      const firstPointInCandidate = hdRoute.route[0]
      const lastPointInCandidate = hdRoute.route[hdRoute.route.length - 1]

      const distToFirst = distance(lastMergedPoint, firstPointInCandidate)
      const distToLast = distance(lastMergedPoint, lastPointInCandidate)
      const firstAdjacentPoint = hdRoute.route[1]
      const lastAdjacentPoint = hdRoute.route[hdRoute.route.length - 2]
      const firstEndpointIsMovable = Boolean(
        firstAdjacentPoint &&
          firstAdjacentPoint.z === firstPointInCandidate.z &&
          !firstPointInCandidate.toNextSegmentType &&
          !firstPointInCandidate.pcb_port_id &&
          !hdRoute.startPcbPortId &&
          !hdRoute.vias.some(
            (via) => distance(via, firstPointInCandidate) < GEOMETRIC_TOLERANCE,
          ),
      )
      const lastEndpointIsMovable = Boolean(
        lastAdjacentPoint &&
          lastAdjacentPoint.z === lastPointInCandidate.z &&
          !lastAdjacentPoint.toNextSegmentType &&
          !lastPointInCandidate.pcb_port_id &&
          !hdRoute.endPcbPortId &&
          !hdRoute.vias.some(
            (via) => distance(via, lastPointInCandidate) < GEOMETRIC_TOLERANCE,
          ),
      )
      const firstOverlapJoinPoint = getOverlapJoinPoint(
        hdRoute,
        firstPointInCandidate,
        firstEndpointIsMovable,
      )
      const lastOverlapJoinPoint = getOverlapJoinPoint(
        hdRoute,
        lastPointInCandidate,
        lastEndpointIsMovable,
      )

      if (lastMergedPoint.z === firstPointInCandidate.z) {
        if (distToFirst < GEOMETRIC_TOLERANCE) {
          candidates.push({
            routeIndex: i,
            matchedOn: "first",
            endpoint: firstPointInCandidate,
            lowerBoundScore: distToFirst,
            needsPlanarPath: false,
          })
        } else if (firstOverlapJoinPoint) {
          candidates.push({
            routeIndex: i,
            matchedOn: "first",
            endpoint: firstPointInCandidate,
            lowerBoundScore: distToFirst,
            needsPlanarPath: false,
            overlapJoinPoint: firstOverlapJoinPoint,
          })
        } else if (canConsiderPlanarGap(distToFirst)) {
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
        } else if (lastOverlapJoinPoint) {
          candidates.push({
            routeIndex: i,
            matchedOn: "last",
            endpoint: lastPointInCandidate,
            lowerBoundScore: distToLast,
            needsPlanarPath: false,
            overlapJoinPoint: lastOverlapJoinPoint,
          })
        } else if (canConsiderPlanarGap(distToLast)) {
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
        (a.matchedOn === b.matchedOn ? 0 : a.matchedOn === "first" ? -1 : 1),
    )

    const hasLayerCompatibleContinuation = (
      candidate: StitchCandidate,
    ): boolean => {
      const route = this.remainingHdRoutes[candidate.routeIndex]!
      const exitPoint =
        candidate.matchedOn === "first"
          ? route.route[route.route.length - 1]!
          : route.route[0]!

      if (exitPoint.z === this.end.z) return true
      if (
        Math.hypot(exitPoint.x - this.end.x, exitPoint.y - this.end.y) <
          GEOMETRIC_TOLERANCE &&
        (!this.allowedLayerTransitionPointKeys ||
          this.allowedLayerTransitionPointKeys.has(getXyPointKey(this.end)))
      ) {
        return true
      }

      for (let index = 0; index < this.remainingHdRoutes.length; index += 1) {
        if (index === candidate.routeIndex) continue
        const nextRoute = this.remainingHdRoutes[index]!
        for (const endpoint of [
          nextRoute.route[0]!,
          nextRoute.route[nextRoute.route.length - 1]!,
        ]) {
          if (endpoint.z === exitPoint.z) return true
          if (
            Math.hypot(exitPoint.x - endpoint.x, exitPoint.y - endpoint.y) <
              GEOMETRIC_TOLERANCE &&
            (!this.allowedLayerTransitionPointKeys ||
              this.allowedLayerTransitionPointKeys.has(
                getXyPointKey(endpoint),
              ))
          ) {
            return true
          }
        }
      }

      return false
    }

    for (const candidate of candidates) {
      const strandsLayer = !hasLayerCompatibleContinuation(candidate)
      let score = candidate.lowerBoundScore
      let stitchPath: Point3[] | undefined
      let mergedRetreatAnchor: RetreatAnchor | undefined
      let candidateRetreatAnchor: RetreatAnchor | undefined
      if (candidate.needsPlanarPath) {
        stitchPath = this.getPlanarStitchPath({
          connectionName: this.mergedHdRoute.connectionName,
          start: lastMergedPoint,
          end: candidate.endpoint,
          traceThickness: this.mergedHdRoute.traceThickness,
        })
        let retreatDistance = 0
        if (!stitchPath) {
          const hdRoute = this.remainingHdRoutes[candidate.routeIndex]!
          const candidatePoints =
            candidate.matchedOn === "first"
              ? hdRoute.route
              : reverseRoutePoints(hdRoute.route)
          const candidateEndpointIsProtected = Boolean(
            candidate.matchedOn === "first"
              ? hdRoute.startPcbPortId
              : hdRoute.endPcbPortId,
          )
          const retreatPlan = this.getRetreatedPlanarStitchPlan({
            candidatePoints,
            candidateEndpointIsProtected,
          })
          if (!retreatPlan) continue
          stitchPath = retreatPlan.path
          mergedRetreatAnchor = retreatPlan.mergedAnchor
          candidateRetreatAnchor = retreatPlan.candidateAnchor
          retreatDistance = retreatPlan.retreatDistance
        }
        score = GAP_PENALTY + retreatDistance + this.getPathLength(stitchPath)
      }
      if (closestRouteIndex !== -1) {
        if (bestStrandsLayer !== strandsLayer) {
          if (strandsLayer) continue
        } else if (score >= bestScore) {
          continue
        }
      }
      bestScore = score
      bestStrandsLayer = strandsLayer
      closestRouteIndex = candidate.routeIndex
      matchedOn = candidate.matchedOn
      bestStitchPath = stitchPath
      bestMergedRetreatAnchor = mergedRetreatAnchor
      bestCandidateRetreatAnchor = candidateRetreatAnchor
      bestOverlapJoinPoint = candidate.overlapJoinPoint
    }

    if (closestRouteIndex === -1) {
      if (this.isValidStitchSegment) {
        if (this.tryCompleteTerminalStitch(lastMergedPoint)) {
          this.remainingHdRoutes = []
          return
        }
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
    if (bestOverlapJoinPoint) {
      const mergedLastIndex = this.mergedHdRoute.route.length - 1
      this.mergedHdRoute.route[mergedLastIndex] = {
        ...this.mergedHdRoute.route[mergedLastIndex]!,
        ...bestOverlapJoinPoint,
      }
      pointsToAdd = [
        { ...pointsToAdd[0]!, ...bestOverlapJoinPoint },
        ...pointsToAdd.slice(1),
      ]
    }
    if (bestCandidateRetreatAnchor) {
      pointsToAdd = pointsToAdd.slice(bestCandidateRetreatAnchor.trimCount)
      if (bestCandidateRetreatAnchor.isVirtual) {
        pointsToAdd.unshift({ ...bestCandidateRetreatAnchor.point })
      }
    }
    if (bestMergedRetreatAnchor) {
      this.applyMergedRetreat(bestMergedRetreatAnchor)
    }
    const mergedAnchor =
      this.mergedHdRoute.route[this.mergedHdRoute.route.length - 1]!

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
      distance(mergedAnchor, pointsToAdd[0]) < GEOMETRIC_TOLERANCE &&
      mergedAnchor.z === pointsToAdd[0].z
    ) {
      if (pointsToAdd[0].toNextSegmentType) {
        mergedAnchor.toNextSegmentType = pointsToAdd[0].toNextSegmentType
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
