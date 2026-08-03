import { distance, type Point3 } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import type { Obstacle } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import type { StitchRepairPolicy } from "./routeStitchingEndpointHelpers"
import {
  comparePoints,
  compareRoutes,
  DISTANCE_TIE_TOLERANCE,
  MAX_STITCH_GAP_DISTANCE_3,
  MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
} from "./routeStitchingShared"
import { visualizeSingleHighDensityRouteStitchSolver3 } from "./visualize-single-high-density-route-stitch-solver3"

const VIA_PENALTY = 1000
const GAP_PENALTY = 100000
const GEOMETRIC_TOLERANCE = 1e-3
type RoutePoint = HighDensityIntraNodeRoute["route"][number]
type StitchTerminal = Point3 & { pcb_port_id?: string }
type TerminalAnchorPointKey = string
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
type TerminalCandidate = {
  route: HighDensityIntraNodeRoute
  endpoint: RoutePoint
  terminal: StitchTerminal
  terminalKind: "start" | "end"
  lowerBound: number
}
type StitchCandidate = {
  routeIndex: number
  matchedOn: "first" | "last"
  endpoint: RoutePoint
  lowerBoundScore: number
  needsPlanarPath: boolean
  overlapJoinPoint?: Point3
}
type DisjointedRouteSelection = {
  firstRoute: HighDensityIntraNodeRoute | undefined
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
  readonly inputHdRoutes: HighDensityIntraNodeRoute[]
  remainingHdRoutes: HighDensityIntraNodeRoute[]
  start: StitchTerminal
  end: StitchTerminal
  colorMap: Record<string, string>
  obstacles: Obstacle[]
  allowedLayerTransitionPointKeys?: Set<string>
  isValidStitchSegment?: IsValidStitchSegment
  findValidStitchPath?: FindValidStitchPath
  isTerminalCoveredByTrace?: IsTerminalCoveredByTrace
  stitchRepairPolicy: StitchRepairPolicy
  private terminalAnchorPointKeys = new Set<TerminalAnchorPointKey>()

  private getPointKey(point: Point3): string {
    return `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`
  }

  private isTerminalAnchor(point: Point3): boolean {
    return this.terminalAnchorPointKeys.has(this.getPointKey(point))
  }

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

  /**
   * A validated straight bridge may span any distance, but obstacle detours are
   * local stitch repair. Keeping the visibility search local prevents a
   * blocked fragment from turning stitching into a board-wide rerouter.
   */
  private getLocalPlanarStitchPath(
    params: StitchSegmentRequest,
    maxDetourDistance: number,
  ): Point3[] | undefined {
    if (params.start.z !== params.end.z) return undefined
    if (distance(params.start, params.end) < GEOMETRIC_TOLERANCE) {
      return [params.start]
    }
    if (!this.isValidStitchSegment || this.isValidStitchSegment(params)) {
      return [params.start, params.end]
    }
    if (distance(params.start, params.end) > maxDetourDistance) {
      return undefined
    }
    const path = this.getPlanarStitchPath(params)
    if (path) return path
    return this.stitchRepairPolicy === "allow_drc_repair"
      ? [params.start, params.end]
      : undefined
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
      this.isTerminalLocation(endpoint) || this.isTerminalAnchor(endpoint),
      (point) => this.isTerminalLocation(point) || this.isTerminalAnchor(point),
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
        const path = this.getLocalPlanarStitchPath(
          {
            connectionName: this.mergedHdRoute.connectionName,
            start: mergedAnchor.point,
            end: candidateAnchor.point,
            traceThickness: this.mergedHdRoute.traceThickness,
          },
          MAX_STITCH_GAP_DISTANCE_3,
        )
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
      const path = this.getLocalPlanarStitchPath(
        {
          connectionName: this.mergedHdRoute.connectionName,
          start: mergedAnchor.point,
          end: terminalOnMergedLayer,
          traceThickness: this.mergedHdRoute.traceThickness,
        },
        MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
      )
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

    const directTerminalPath = this.getLocalPlanarStitchPath(
      {
        connectionName: this.mergedHdRoute.connectionName,
        start: lastMergedPoint,
        end: endOnMergedLayer,
        traceThickness: this.mergedHdRoute.traceThickness,
      },
      MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
    )
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
      : planarTerminalDistance <= MAX_TERMINAL_STITCH_GAP_DISTANCE_3
        ? this.getRetreatedTerminalStitchPlan(endOnMergedLayer)
        : undefined

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

  private clearLastSegmentMetadata(): void {
    const lastIndex = this.mergedHdRoute.route.length - 1
    const lastPoint = this.mergedHdRoute.route[lastIndex]!
    if (!lastPoint.toNextSegmentType) return
    const { toNextSegmentType: _removedSegmentType, ...anchor } = lastPoint
    this.mergedHdRoute.route[lastIndex] = anchor
  }

  private applyMergedRetreat(anchor: RetreatAnchor): void {
    if (anchor.trimCount === 0) return
    this.mergedHdRoute.route.splice(-anchor.trimCount, anchor.trimCount)
    this.clearLastSegmentMetadata()
    if (anchor.isVirtual) {
      this.mergedHdRoute.route.push({ ...anchor.point })
    }
  }

  /**
   * A selected same-net route set can contain a branch. Once its leaf is
   * consumed, return over the copper and via that were just laid so stitching
   * can continue from the branch point without dropping either branch.
   */
  private canContinueFromRoutePoint(anchor: RoutePoint): boolean {
    for (const remainingRoute of this.remainingHdRoutes) {
      for (const endpoint of [
        remainingRoute.route[0]!,
        remainingRoute.route[remainingRoute.route.length - 1]!,
      ]) {
        if (anchor.z !== endpoint.z) {
          if (
            Math.hypot(anchor.x - endpoint.x, anchor.y - endpoint.y) <
              GEOMETRIC_TOLERANCE &&
            (!this.allowedLayerTransitionPointKeys ||
              this.allowedLayerTransitionPointKeys.has(getXyPointKey(endpoint)))
          ) {
            return true
          }
          continue
        }
        if (distance(anchor, endpoint) > MAX_STITCH_GAP_DISTANCE_3) continue
        if (
          this.getLocalPlanarStitchPath(
            {
              connectionName: this.mergedHdRoute.connectionName,
              start: anchor,
              end: endpoint,
              traceThickness: this.mergedHdRoute.traceThickness,
            },
            MAX_STITCH_GAP_DISTANCE_3,
          )
        ) {
          return true
        }
      }
    }
    return false
  }

  private tryBacktrackToRemainingRoute(): boolean {
    const route = this.mergedHdRoute.route
    for (let index = route.length - 2; index >= 0; index -= 1) {
      if (!this.canContinueFromRoutePoint(route[index]!)) continue
      const retracedPoints = reverseRoutePoints(route.slice(index)).slice(1)
      this.mergedHdRoute.route.push(...retracedPoints)
      return true
    }

    return false
  }

  private getTerminalDistance({
    connectionName,
    terminal,
    endpoint,
    traceThickness,
  }: {
    connectionName: string
    terminal: StitchTerminal
    endpoint: RoutePoint
    traceThickness: number
  }): number {
    const terminalOnEndpointLayer = { ...terminal, z: endpoint.z }
    if (
      !this.isValidStitchSegment &&
      distance(terminalOnEndpointLayer, endpoint) >
        MAX_TERMINAL_STITCH_GAP_DISTANCE_3
    ) {
      return Infinity
    }
    const path = this.getLocalPlanarStitchPath(
      {
        connectionName,
        start: terminalOnEndpointLayer,
        end: endpoint,
        traceThickness,
      },
      MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
    )
    if (!path) return Infinity
    return Math.abs(terminal.z - endpoint.z) + this.getPathLength(path)
  }

  private canConsiderPlanarGap({
    anchor,
    endpoint,
    gapDistance,
  }: {
    anchor: RoutePoint
    endpoint: RoutePoint
    gapDistance: number
  }): boolean {
    if (gapDistance <= MAX_STITCH_GAP_DISTANCE_3) return true
    return Boolean(
      this.isValidStitchSegment?.({
        connectionName: this.mergedHdRoute.connectionName,
        start: anchor,
        end: endpoint,
        traceThickness: this.mergedHdRoute.traceThickness,
      }),
    )
  }

  private getOverlapJoinPoint({
    hdRoute,
    mergedEndpoint,
    candidateEndpoint,
    mergedEndpointIsMovable,
    candidateEndpointIsMovable,
  }: {
    hdRoute: HighDensityIntraNodeRoute
    mergedEndpoint: RoutePoint
    candidateEndpoint: RoutePoint
    mergedEndpointIsMovable: boolean
    candidateEndpointIsMovable: boolean
  }): Point3 | undefined {
    if (!mergedEndpointIsMovable || !candidateEndpointIsMovable) {
      return undefined
    }
    const endpointDistance = distance(mergedEndpoint, candidateEndpoint)
    const mergedRadius =
      (mergedEndpoint.traceThickness ?? this.mergedHdRoute.traceThickness) / 2
    const candidateRadius =
      (candidateEndpoint.traceThickness ?? hdRoute.traceThickness) / 2
    const combinedRadius = mergedRadius + candidateRadius
    if (endpointDistance > combinedRadius + GEOMETRIC_TOLERANCE) {
      return undefined
    }
    const mergedShare = mergedRadius / combinedRadius
    return {
      x:
        mergedEndpoint.x +
        (candidateEndpoint.x - mergedEndpoint.x) * mergedShare,
      y:
        mergedEndpoint.y +
        (candidateEndpoint.y - mergedEndpoint.y) * mergedShare,
      z: mergedEndpoint.z,
    }
  }

  private tryBacktrackToTerminal(): boolean {
    if (this.terminalAnchorPointKeys.size === 0) return false

    const route = this.mergedHdRoute.route
    for (let index = route.length - 2; index >= 0; index -= 1) {
      const anchor = route[index]!
      if (!this.isTerminalAnchor(anchor)) continue
      if (
        anchor.z !== this.end.z &&
        this.allowedLayerTransitionPointKeys &&
        !this.allowedLayerTransitionPointKeys.has(getXyPointKey(this.end))
      ) {
        continue
      }
      const terminalOnAnchorLayer = { ...this.end, z: anchor.z }
      if (
        !this.isValidStitchSegment &&
        distance(anchor, terminalOnAnchorLayer) >
          MAX_TERMINAL_STITCH_GAP_DISTANCE_3
      ) {
        continue
      }
      if (
        !this.getLocalPlanarStitchPath(
          {
            connectionName: this.mergedHdRoute.connectionName,
            start: anchor,
            end: terminalOnAnchorLayer,
            traceThickness: this.mergedHdRoute.traceThickness,
          },
          MAX_TERMINAL_STITCH_GAP_DISTANCE_3,
        )
      ) {
        continue
      }

      const retracedPoints = reverseRoutePoints(route.slice(index)).slice(1)
      this.mergedHdRoute.route.push(...retracedPoints)
      return true
    }

    return false
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
    stitchRepairPolicy?: StitchRepairPolicy
    obstacles?: Obstacle[]
  }) {
    super()
    const canonicalHdRoutes = [...opts.hdRoutes].sort(compareRoutes)
    this.inputHdRoutes = [...canonicalHdRoutes]
    this.remainingHdRoutes = canonicalHdRoutes
    this.colorMap = opts.colorMap ?? {}
    this.obstacles = opts.obstacles ?? []
    this.allowedLayerTransitionPointKeys = opts.allowedLayerTransitionPointKeys
    this.isValidStitchSegment = opts.isValidStitchSegment
    this.findValidStitchPath = opts.findValidStitchPath
    this.isTerminalCoveredByTrace = opts.isTerminalCoveredByTrace
    this.stitchRepairPolicy = opts.stitchRepairPolicy ?? "validated_only"

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

    const terminalCandidates: TerminalCandidate[] = []
    for (const route of canonicalHdRoutes) {
      for (const endpoint of [
        route.route[0]!,
        route.route[route.route.length - 1]!,
      ]) {
        for (const [terminalKind, terminal] of [
          ["start", opts.start],
          ["end", opts.end],
        ] as const) {
          const terminalOnEndpointLayer = {
            x: terminal.x,
            y: terminal.y,
            z: endpoint.z,
          }
          terminalCandidates.push({
            route,
            endpoint,
            terminal,
            terminalKind,
            lowerBound:
              Math.abs(terminal.z - endpoint.z) +
              distance(terminalOnEndpointLayer, endpoint),
          })
        }
      }
    }
    terminalCandidates.sort(
      (a, b) =>
        a.lowerBound - b.lowerBound ||
        compareRoutes(a.route, b.route) ||
        comparePoints(a.endpoint, b.endpoint) ||
        (a.terminalKind === b.terminalKind
          ? 0
          : a.terminalKind === "start"
            ? -1
            : 1),
    )

    let bestDist = Infinity
    let firstRoute = canonicalHdRoutes[0]
    let firstTerminalKind: "start" | "end" = "start"
    const preferredTerminalKind: "start" | "end" =
      comparePoints(opts.end, opts.start) < 0 ? "end" : "start"
    for (const candidate of terminalCandidates) {
      if (candidate.lowerBound > bestDist + DISTANCE_TIE_TOLERANCE) break
      const candidateDistance = this.getTerminalDistance({
        connectionName: opts.connectionName,
        terminal: candidate.terminal,
        endpoint: candidate.endpoint,
        traceThickness: candidate.route.traceThickness,
      })
      const routeComparison = compareRoutes(candidate.route, firstRoute!)
      if (
        candidateDistance < bestDist - DISTANCE_TIE_TOLERANCE ||
        (Math.abs(candidateDistance - bestDist) <= DISTANCE_TIE_TOLERANCE &&
          (routeComparison < 0 ||
            (routeComparison === 0 &&
              candidate.terminalKind === preferredTerminalKind &&
              firstTerminalKind !== preferredTerminalKind)))
      ) {
        bestDist = candidateDistance
        firstRoute = candidate.route
        firstTerminalKind = candidate.terminalKind
      }
    }

    if (!Number.isFinite(bestDist)) {
      this.start = opts.start
      this.end = opts.end
      this.failed = true
      this.error = `No collision-free terminal stitch segment for "${opts.connectionName}"`
      return
    }

    const orientation =
      firstTerminalKind === "start" ? "start-to-end" : "end-to-start"
    if (orientation === "start-to-end") {
      this.start = opts.start
      this.end = opts.end
    } else {
      this.start = opts.end
      this.end = opts.start
    }

    let bestTerminalAnchorDistance = Infinity
    const endTerminalKind = orientation === "start-to-end" ? "end" : "start"
    for (const candidate of terminalCandidates) {
      if (candidate.terminalKind !== endTerminalKind) continue
      if (
        candidate.lowerBound >
        bestTerminalAnchorDistance + DISTANCE_TIE_TOLERANCE
      ) {
        break
      }
      if (
        candidate.endpoint.z !== this.end.z &&
        this.allowedLayerTransitionPointKeys &&
        !this.allowedLayerTransitionPointKeys.has(getXyPointKey(this.end))
      ) {
        continue
      }
      const terminalDistance = this.getTerminalDistance({
        connectionName: opts.connectionName,
        terminal: candidate.terminal,
        endpoint: candidate.endpoint,
        traceThickness: candidate.route.traceThickness,
      })
      const key = this.getPointKey(candidate.endpoint)
      if (
        terminalDistance <
        bestTerminalAnchorDistance - DISTANCE_TIE_TOLERANCE
      ) {
        bestTerminalAnchorDistance = terminalDistance
        this.terminalAnchorPointKeys.clear()
        this.terminalAnchorPointKeys.add(key)
      } else if (
        Math.abs(terminalDistance - bestTerminalAnchorDistance) <=
        DISTANCE_TIE_TOLERANCE
      ) {
        this.terminalAnchorPointKeys.add(key)
      }
    }

    const firstRouteFirstPoint = firstRoute.route[0]
    const firstRouteLastPoint = firstRoute.route[firstRoute.route.length - 1]
    const distToFirst = this.getTerminalDistance({
      connectionName: opts.connectionName,
      terminal: this.start,
      endpoint: firstRouteFirstPoint,
      traceThickness: firstRoute.traceThickness,
    })
    const distToLast = this.getTerminalDistance({
      connectionName: opts.connectionName,
      terminal: this.start,
      endpoint: firstRouteLastPoint,
      traceThickness: firstRoute.traceThickness,
    })
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

  getDisjointedRoute(): DisjointedRouteSelection {
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
            (otherEnd) =>
              otherEnd.z === end.z &&
              distance(end, otherEnd) < GEOMETRIC_TOLERANCE,
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

      if (this.isTerminalReachedByCopper(lastMergedPoint)) {
        this.solved = true
        return
      }

      if (
        !this.isTerminalAnchor(lastMergedPoint) &&
        this.tryBacktrackToTerminal()
      ) {
        return
      }

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

    let closestRouteIndex = -1
    let matchedOn: "first" | "last" = "first"
    let bestScore = Infinity
    let bestStitchPath: Point3[] | undefined
    let bestMergedRetreatAnchor: RetreatAnchor | undefined
    let bestCandidateRetreatAnchor: RetreatAnchor | undefined
    let bestOverlapJoinPoint: Point3 | undefined

    const candidates: StitchCandidate[] = []
    const mergedPreviousPoint =
      this.mergedHdRoute.route[this.mergedHdRoute.route.length - 2]
    const mergedEndpointIsMovable = Boolean(
      mergedPreviousPoint &&
        mergedPreviousPoint.z === lastMergedPoint.z &&
        !mergedPreviousPoint.toNextSegmentType &&
        !lastMergedPoint.pcb_port_id &&
        !this.isTerminalLocation(lastMergedPoint) &&
        !this.isTerminalAnchor(lastMergedPoint) &&
        !this.mergedHdRoute.vias.some(
          (via) => distance(via, lastMergedPoint) < GEOMETRIC_TOLERANCE,
        ),
    )

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
          !this.isTerminalAnchor(firstPointInCandidate) &&
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
          !this.isTerminalAnchor(lastPointInCandidate) &&
          !hdRoute.vias.some(
            (via) => distance(via, lastPointInCandidate) < GEOMETRIC_TOLERANCE,
          ),
      )
      const firstOverlapJoinPoint = this.getOverlapJoinPoint({
        hdRoute,
        mergedEndpoint: lastMergedPoint,
        candidateEndpoint: firstPointInCandidate,
        mergedEndpointIsMovable,
        candidateEndpointIsMovable: firstEndpointIsMovable,
      })
      const lastOverlapJoinPoint = this.getOverlapJoinPoint({
        hdRoute,
        mergedEndpoint: lastMergedPoint,
        candidateEndpoint: lastPointInCandidate,
        mergedEndpointIsMovable,
        candidateEndpointIsMovable: lastEndpointIsMovable,
      })

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
        } else if (
          this.canConsiderPlanarGap({
            anchor: lastMergedPoint,
            endpoint: firstPointInCandidate,
            gapDistance: distToFirst,
          })
        ) {
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
        } else if (
          this.canConsiderPlanarGap({
            anchor: lastMergedPoint,
            endpoint: lastPointInCandidate,
            gapDistance: distToLast,
          })
        ) {
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

    for (const candidate of candidates) {
      if (candidate.lowerBoundScore >= bestScore) break
      let score = candidate.lowerBoundScore
      let stitchPath: Point3[] | undefined
      let mergedRetreatAnchor: RetreatAnchor | undefined
      let candidateRetreatAnchor: RetreatAnchor | undefined
      if (candidate.needsPlanarPath) {
        stitchPath = this.getLocalPlanarStitchPath(
          {
            connectionName: this.mergedHdRoute.connectionName,
            start: lastMergedPoint,
            end: candidate.endpoint,
            traceThickness: this.mergedHdRoute.traceThickness,
          },
          MAX_STITCH_GAP_DISTANCE_3,
        )
        let retreatDistance = 0
        if (!stitchPath) {
          const hdRoute = this.remainingHdRoutes[candidate.routeIndex]!
          const candidatePoints =
            candidate.matchedOn === "first"
              ? hdRoute.route
              : reverseRoutePoints(hdRoute.route)
          const candidateEndpointIsProtected = Boolean(
            candidate.matchedOn === "first"
              ? hdRoute.startPcbPortId ||
                  this.isTerminalAnchor(candidatePoints[0]!)
              : hdRoute.endPcbPortId ||
                  this.isTerminalAnchor(candidatePoints[0]!),
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
      if (score >= bestScore) continue
      bestScore = score
      closestRouteIndex = candidate.routeIndex
      matchedOn = candidate.matchedOn
      bestStitchPath = stitchPath
      bestMergedRetreatAnchor = mergedRetreatAnchor
      bestCandidateRetreatAnchor = candidateRetreatAnchor
      bestOverlapJoinPoint = candidate.overlapJoinPoint
    }

    if (closestRouteIndex === -1) {
      if (this.isValidStitchSegment) {
        if (this.tryBacktrackToRemainingRoute()) return
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
    const candidateAnchor = pointsToAdd[0]
    const stitchLayerTransition =
      candidateAnchor && mergedAnchor.z !== candidateAnchor.z
        ? { x: candidateAnchor.x, y: candidateAnchor.y }
        : undefined

    if (stitchLayerTransition) {
      const transitionStart = {
        ...stitchLayerTransition,
        z: mergedAnchor.z,
      }
      if (distance(mergedAnchor, transitionStart) >= GEOMETRIC_TOLERANCE) {
        throw new Error(
          `Layer-changing stitch for "${this.mergedHdRoute.connectionName}" exceeds the endpoint tolerance`,
        )
      }
      if (
        mergedAnchor.x !== transitionStart.x ||
        mergedAnchor.y !== transitionStart.y
      ) {
        this.mergedHdRoute.route.push(transitionStart)
      }
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
    if (
      stitchLayerTransition &&
      !this.mergedHdRoute.vias.some(
        (via) =>
          distance(via, stitchLayerTransition) < GEOMETRIC_TOLERANCE,
      )
    ) {
      this.mergedHdRoute.vias.push(stitchLayerTransition)
    }

    if (hdRouteToMerge.jumpers) {
      this.mergedHdRoute.jumpers!.push(...hdRouteToMerge.jumpers)
    }
  }

  visualize(): GraphicsObject {
    return visualizeSingleHighDensityRouteStitchSolver3({
      inputHdRoutes: this.inputHdRoutes,
      mergedHdRoute: this.mergedHdRoute,
      remainingHdRoutes: this.remainingHdRoutes,
      start: this.start,
      end: this.end,
      colorMap: this.colorMap,
      obstacles: this.obstacles,
      stitchRepairPolicy: this.stitchRepairPolicy,
      isValidStitchSegment: this.isValidStitchSegment,
    })
  }
}
