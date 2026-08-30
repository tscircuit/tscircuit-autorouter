import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import {
  getRerouteSimpleRouteJson,
  reconnectReroutedSimpleRouteJsonRegion,
  type RerouteRectRegion,
} from "lib/utils/getRerouteSimpleRouteJson"

type Point = { x: number; y: number }

type RegionalPipelineSolver = BaseSolver & {
  getOutputSimplifiedPcbTraces: () => SimplifiedPcbTraces
}

export interface RegionalDrcRerouteSolverParams {
  inputSrj: SimpleRouteJson
  originalSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  createPipelineSolver: (srj: SimpleRouteJson) => RegionalPipelineSolver
  enabled?: boolean
  minimumClusterSize?: number
  clusterDistance?: number
  regionPadding?: number
  minimumRegionSpan?: number
  maximumRegionAreaRatio?: number
  maximumRerouteConnections?: number
  maximumBaselineErrorCount?: number
  maximumReroutePasses?: number
}

const getErrorCenter = (error: unknown): Point | null => {
  if (!error || typeof error !== "object") return null
  const center = (error as { center?: unknown }).center
  if (!center || typeof center !== "object") return null
  const { x, y } = center as { x?: unknown; y?: unknown }
  return typeof x === "number" && typeof y === "number" ? { x, y } : null
}

const getErrorClusters = (centers: Point[], clusterDistance: number) => {
  const remaining = new Set(centers.map((_, index) => index))
  const clusters: Point[][] = []

  while (remaining.size > 0) {
    const firstIndex = remaining.values().next().value as number
    const pending = [firstIndex]
    const cluster: Point[] = []
    remaining.delete(firstIndex)

    while (pending.length > 0) {
      const currentIndex = pending.pop()!
      const current = centers[currentIndex]!
      cluster.push(current)

      for (const candidateIndex of remaining) {
        const candidate = centers[candidateIndex]!
        if (
          Math.hypot(candidate.x - current.x, candidate.y - current.y) <=
          clusterDistance
        ) {
          remaining.delete(candidateIndex)
          pending.push(candidateIndex)
        }
      }
    }

    clusters.push(cluster)
  }

  return clusters.sort((a, b) => b.length - a.length)
}

export const getRegionAreaRatio = (
  region: RerouteRectRegion,
  bounds: SimpleRouteJson["bounds"],
): number => {
  const regionArea = (region.maxX - region.minX) * (region.maxY - region.minY)
  const boardArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)
  return boardArea > 0 ? regionArea / boardArea : Number.POSITIVE_INFINITY
}

const getClusterRegion = ({
  cluster,
  padding,
  minimumSpan,
  boardCenter,
}: {
  cluster: Point[]
  padding: number
  minimumSpan: number
  boardCenter: Point
}): RerouteRectRegion => {
  const minCenterX = Math.min(...cluster.map((point) => point.x))
  const maxCenterX = Math.max(...cluster.map((point) => point.x))
  const minCenterY = Math.min(...cluster.map((point) => point.y))
  const maxCenterY = Math.max(...cluster.map((point) => point.y))
  const centerX = (minCenterX + maxCenterX) / 2
  const centerY = (minCenterY + maxCenterY) / 2
  const width = Math.max(minimumSpan, maxCenterX - minCenterX + 2 * padding)
  const height = Math.max(minimumSpan, maxCenterY - minCenterY + 2 * padding)

  const region = {
    shape: "rect",
    minX: centerX - width / 2,
    maxX: centerX + width / 2,
    minY: centerY - height / 2,
    maxY: centerY + height / 2,
  } as const
  const grid = 0.5
  const snapOutward = (value: number, direction: number) =>
    direction >= 0
      ? Math.ceil(value / grid) * grid
      : Math.floor(value / grid) * grid

  return {
    shape: "rect",
    minX: snapOutward(region.minX, centerX - boardCenter.x),
    maxX: snapOutward(region.maxX, centerX - boardCenter.x),
    minY: snapOutward(region.minY, centerY - boardCenter.y),
    maxY: snapOutward(region.maxY, centerY - boardCenter.y),
  }
}

export class RegionalDrcRerouteSolver extends BaseSolver {
  private readonly inputSrj: SimpleRouteJson
  private readonly originalSrj: SimpleRouteJson
  private readonly srjWithPointPairs: SimpleRouteJson
  private readonly createPipelineSolver: (
    srj: SimpleRouteJson,
  ) => RegionalPipelineSolver
  private readonly enabled: boolean
  private readonly minimumClusterSize: number
  private readonly clusterDistance: number
  private readonly regionPadding: number
  private readonly minimumRegionSpan: number
  private readonly maximumRegionAreaRatio: number
  private readonly maximumRerouteConnections: number
  private readonly maximumBaselineErrorCount: number
  private readonly maximumReroutePasses: number
  private outputTraces: SimplifiedPcbTraces
  private rerouteInput?: SimpleRouteJson
  private rerouteRegion?: RerouteRectRegion
  private baselineErrorCount = 0
  private currentPassBaselineErrorCount = 0
  private completedRerouteRegions: RerouteRectRegion[] = []
  private reroutePassCount = 0

  constructor({
    inputSrj,
    originalSrj,
    srjWithPointPairs,
    createPipelineSolver,
    enabled = true,
    minimumClusterSize = 4,
    clusterDistance = 3,
    regionPadding = 1,
    minimumRegionSpan = 6,
    maximumRegionAreaRatio = 0.05,
    maximumRerouteConnections = 24,
    maximumBaselineErrorCount = 6,
    maximumReroutePasses = 1,
  }: RegionalDrcRerouteSolverParams) {
    super()
    this.inputSrj = structuredClone(inputSrj)
    this.originalSrj = structuredClone(originalSrj)
    this.srjWithPointPairs = structuredClone(srjWithPointPairs)
    this.createPipelineSolver = createPipelineSolver
    this.enabled = enabled
    this.minimumClusterSize = minimumClusterSize
    this.clusterDistance = clusterDistance
    this.regionPadding = regionPadding
    this.minimumRegionSpan = minimumRegionSpan
    this.maximumRegionAreaRatio = maximumRegionAreaRatio
    this.maximumRerouteConnections = maximumRerouteConnections
    this.maximumBaselineErrorCount = maximumBaselineErrorCount
    this.maximumReroutePasses = maximumReroutePasses
    this.outputTraces = structuredClone(inputSrj.traces ?? [])
    this.MAX_ITERATIONS = 100e6
  }

  private evaluate(traces: SimplifiedPcbTraces) {
    return evaluateRelaxedDrc({
      inputSrj: this.originalSrj,
      srjWithPointPairs: this.srjWithPointPairs,
      routedTraces: traces,
    }).errorsWithCenters
  }

  private initializeReroute() {
    if (!this.enabled || (this.inputSrj.differentialPairs?.length ?? 0) > 0) {
      this.solved = true
      return
    }

    const baselineErrors = this.evaluate(this.outputTraces)
    if (this.reroutePassCount === 0) {
      this.baselineErrorCount = baselineErrors.length
    }
    this.currentPassBaselineErrorCount = baselineErrors.length
    if (
      this.reroutePassCount === 0 &&
      this.baselineErrorCount > this.maximumBaselineErrorCount
    ) {
      this.stats = {
        baselineErrorCount: this.baselineErrorCount,
        accepted: false,
        reason: "baseline_error_limit",
      }
      this.solved = true
      return
    }
    const centers = baselineErrors
      .map(getErrorCenter)
      .filter((center): center is Point => center !== null)
      .filter((center) =>
        this.completedRerouteRegions.every(
          (region) =>
            center.x < region.minX ||
            center.x > region.maxX ||
            center.y < region.minY ||
            center.y > region.maxY,
        ),
      )
    const cluster = getErrorClusters(centers, this.clusterDistance)[0]
    const minimumClusterSize =
      this.reroutePassCount === 0 ? this.minimumClusterSize : 1

    if (!cluster || cluster.length < minimumClusterSize) {
      this.stats = {
        baselineErrorCount: this.baselineErrorCount,
        accepted: false,
        reason: "no_dense_error_cluster",
      }
      this.solved = true
      return
    }

    this.rerouteRegion = getClusterRegion({
      cluster,
      padding: this.regionPadding,
      minimumSpan: this.minimumRegionSpan,
      boardCenter: {
        x: (this.inputSrj.bounds.minX + this.inputSrj.bounds.maxX) / 2,
        y: (this.inputSrj.bounds.minY + this.inputSrj.bounds.maxY) / 2,
      },
    })
    const regionAreaRatio = getRegionAreaRatio(
      this.rerouteRegion,
      this.inputSrj.bounds,
    )
    // A repair box that covers a large share of the board is another global
    // autoroute and can turn an otherwise completed route into a timeout.
    if (regionAreaRatio > this.maximumRegionAreaRatio) {
      this.stats = {
        baselineErrorCount: this.baselineErrorCount,
        clusterSize: cluster.length,
        regionAreaRatio,
        accepted: false,
        reason: "reroute_region_too_large",
      }
      this.solved = true
      return
    }
    this.rerouteInput = getRerouteSimpleRouteJson(
      { ...this.inputSrj, traces: this.outputTraces },
      this.rerouteRegion,
    )

    if (
      this.rerouteInput.connections.length === 0 ||
      this.rerouteInput.connections.length > this.maximumRerouteConnections
    ) {
      this.stats = {
        baselineErrorCount: this.baselineErrorCount,
        clusterSize: cluster.length,
        rerouteConnectionCount: this.rerouteInput.connections.length,
        accepted: false,
        reason: "reroute_connection_limit",
      }
      this.solved = true
      return
    }

    this.activeSubSolver = this.createPipelineSolver(this.rerouteInput)
  }

  private finishReroute() {
    const rerouteSolver = this.activeSubSolver as RegionalPipelineSolver
    if (rerouteSolver.failed) {
      this.stats = {
        baselineErrorCount: this.baselineErrorCount,
        rerouteConnectionCount: this.rerouteInput!.connections.length,
        accepted: false,
        reason: "regional_solver_failed",
      }
      this.activeSubSolver = null
      this.solved = true
      return
    }

    const solvedRegion = {
      ...this.rerouteInput!,
      traces: [
        ...(this.rerouteInput!.traces ?? []),
        ...rerouteSolver.getOutputSimplifiedPcbTraces(),
      ],
    }
    const candidate = reconnectReroutedSimpleRouteJsonRegion(
      this.inputSrj,
      solvedRegion,
    )
    const candidateErrorCount = this.evaluate(candidate.traces ?? []).length
    const accepted = candidateErrorCount < this.currentPassBaselineErrorCount

    if (accepted) {
      this.outputTraces = candidate.traces ?? []
      this.completedRerouteRegions.push(this.rerouteRegion!)
    }
    this.reroutePassCount++
    this.stats = {
      baselineErrorCount: this.baselineErrorCount,
      candidateErrorCount,
      rerouteConnectionCount: this.rerouteInput!.connections.length,
      rerouteRegion: this.rerouteRegion,
      reroutePassCount: this.reroutePassCount,
      accepted,
      reason: accepted ? "improved_relaxed_drc" : "no_relaxed_drc_improvement",
    }
    this.activeSubSolver = null
    if (
      accepted &&
      candidateErrorCount > 0 &&
      this.reroutePassCount < this.maximumReroutePasses
    ) {
      this.rerouteInput = undefined
      this.rerouteRegion = undefined
      return
    }
    this.solved = true
  }

  override _step() {
    if (!this.rerouteInput) {
      this.initializeReroute()
      return
    }

    if (!this.activeSubSolver) {
      this.solved = true
      return
    }

    this.activeSubSolver.step()
    if (this.activeSubSolver.solved || this.activeSubSolver.failed) {
      this.finishReroute()
    }
  }

  getOutputSimplifiedPcbTraces() {
    return structuredClone(this.outputTraces)
  }

  override visualize(): GraphicsObject {
    if (this.activeSubSolver) return this.activeSubSolver.visualize()
    return convertSrjToGraphicsObject(
      { ...this.inputSrj, traces: this.outputTraces },
      { traceColorMode: "layer" },
    )
  }
}
