import { MultiSimplifiedPathSolver, SingleSimplifiedPathSolver5 } from "@tscircuit/trace-simplification-solver"
import { minimumDistanceBetweenSegments } from "../../utils/minimumDistanceBetweenSegments"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { HighDensityRoute } from "../../types/high-density-types"
import type { ParallelPathCertificateStats, ParallelPathQueryCertificate, ParallelPathQueryFootprint, ParallelPathQueryPoint } from "./parallelPathLookaheadTypes"

type GeometryIndex = NonNullable<ConstructorParameters<typeof SingleSimplifiedPathSolver5>[0]["geometryQuery"]>["index"]
type OriginalPhase = Pick<MultiSimplifiedPathSolver, "unsimplifiedHdRoutes" | "useTraceWidthAwareClearance" | "enableVertexShortcuts">
type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
type Line = { start: ParallelPathQueryPoint; end: ParallelPathQueryPoint; buckets: Bounds }
type Via = { x: number; y: number; diameter: number }
type PrimitiveView = { lines: Map<string, Line>; vias: Map<string, Via> }
export type ParallelPathFilterParams = ConstructorParameters<typeof SingleSimplifiedPathSolver5>[0]
export type ParallelPathFilteredPrimitives = Pick<SingleSimplifiedPathSolver5, "filteredObstaclePathSegments" | "filteredVias">

const cellSize = 0.4
const queryMargin = 0.4
const obstacleMargin = 0.1
const traceThickness = 0.15

function pointKey(point: ParallelPathQueryPoint): string {
  // The admitted domain excludes negative zero and nonfinite coordinates, so
  // the canonical Number strings represent exact equality of native operands.
  return `${point.x},${point.y},${point.z}`
}

function isOrdinaryPoint(point: ParallelPathQueryPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isInteger(point.z) &&
    Math.abs(point.x) <= 10_000 && Math.abs(point.y) <= 10_000 &&
    !Object.is(point.x, -0) && !Object.is(point.y, -0)
}

function getPrimitiveView(child: ParallelPathFilteredPrimitives, stats: ParallelPathCertificateStats): PrimitiveView {
  const lines = new Map<string, Line>()
  const vias = new Map<string, Via>()
  stats.nativeFilterSegments += child.filteredObstaclePathSegments.length
  stats.nativeFilterVias += child.filteredVias.length
  for (const [start, end] of child.filteredObstaclePathSegments) {
    if (start.z !== end.z) continue
    lines.set(`${pointKey(start)};${pointKey(end)}`, { start, end, buckets: {
      minX: Math.floor(Math.min(start.x, end.x) / cellSize),
      minY: Math.floor(Math.min(start.y, end.y) / cellSize),
      maxX: Math.floor(Math.max(start.x, end.x) / cellSize),
      maxY: Math.floor(Math.max(start.y, end.y) / cellSize),
    } })
  }
  for (const via of child.filteredVias) vias.set(`${via.x},${via.y},${via.diameter}`, via)
  return { lines, vias }
}

function getChangedValues<T>(before: Map<string, T>, after: Map<string, T>): T[] {
  const values: T[] = []
  for (const [key, value] of before) if (!after.has(key)) values.push(value)
  for (const [key, value] of after) if (!before.has(key)) values.push(value)
  return values
}

/**
 * Certificate for the default native Single5 trajectory, not just its output.
 * Original constructors determine exactly which unresolved peer primitives can
 * be observed. A changed primitive may neither create nor remove a false query.
 */
export class ParallelPathQueryCertifier {
  private readonly originalIndex: GeometryIndex
  private readonly currentIndex: GeometryIndex

  constructor(
    private readonly original: OriginalPhase,
    private readonly current: MultiSimplifiedPathSolver,
    initialGeometryIndex?: GeometryIndex,
  ) {
    this.originalIndex = initialGeometryIndex ?? (original as unknown as { geometryIndex: GeometryIndex }).geometryIndex
    this.currentIndex = (current as unknown as { geometryIndex: GeometryIndex }).geometryIndex
  }

  protected createFilteredPrimitives(params: ParallelPathFilterParams, stats: ParallelPathCertificateStats): ParallelPathFilteredPrimitives {
    stats.nativeFilterConstructors++
    return new SingleSimplifiedPathSolver5(params)
  }

  certify(index: number, committedPrefix: number, footprint: ParallelPathQueryFootprint): ParallelPathQueryCertificate {
    const stats: ParallelPathCertificateStats = { nativeFilterConstructors: 0, nativeFilterOnlyViews: 0, nativeFilterSegments: 0,
      nativeFilterVias: 0, lineBucketTests: 0, lineDistanceTests: 0, viaDistanceTests: 0 }
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(committedPrefix) || committedPrefix < 0 ||
      committedPrefix > index || index >= this.original.unsimplifiedHdRoutes.length) {
      throw new Error("Invalid path query certificate indexes")
    }
    if (this.original.useTraceWidthAwareClearance || this.current.useTraceWidthAwareClearance ||
      this.original.enableVertexShortcuts || this.current.enableVertexShortcuts || !footprint.complete) {
      return { certified: false, stats }
    }
    if (committedPrefix === index) return { certified: true, stats }
    const inputRoute = this.original.unsimplifiedHdRoutes[index]!
    const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (const point of inputRoute.route) {
      if (!isOrdinaryPoint(point)) return { certified: false, stats }
      bounds.minX = Math.min(bounds.minX, point.x)
      bounds.minY = Math.min(bounds.minY, point.y)
      bounds.maxX = Math.max(bounds.maxX, point.x)
      bounds.maxY = Math.max(bounds.maxY, point.y)
    }
    let beforeCandidates: HighDensityRoute[]
    let afterCandidates: HighDensityRoute[]
    try {
      beforeCandidates = this.originalIndex.getCandidateRoutes(bounds, obstacleMargin + traceThickness, index)
      afterCandidates = this.currentIndex.getCandidateRoutes(bounds, obstacleMargin + traceThickness, index)
    } catch {
      return { certified: false, stats, nativeQueryError: true }
    }
    const beforePeers: HighDensityRoute[] = []
    const afterPeers: HighDensityRoute[] = []
    // Iterate indexes, not a one-object-to-one-index map. Aliased original route
    // objects are legitimate; repeating the same geometry is conservative here.
    for (let peer = committedPrefix; peer < index; peer++) {
      const before = this.original.unsimplifiedHdRoutes[peer]!
      const after = this.current.simplifiedHdRoutes[peer]
      if (!after) throw new Error(`Missing committed path route ${peer}`)
      for (const route of [before, after]) {
        if (route.jumpers?.length || !Number.isFinite(route.viaDiameter) || route.viaDiameter < 0 ||
          route.route.some((point) => !isOrdinaryPoint(point)) ||
          route.vias.some((via) => !Number.isFinite(via.x) || !Number.isFinite(via.y) ||
            Object.is(via.x, -0) || Object.is(via.y, -0))) return { certified: false, stats }
      }
      if (beforeCandidates.includes(before)) beforePeers.push(before)
      if (afterCandidates.includes(after)) afterPeers.push(after)
    }
    const common = { inputRoute, obstacles: [], connMap: this.current.connMap, colorMap: {},
      useTraceWidthAwareClearance: false }
    let beforeView: PrimitiveView
    let afterView: PrimitiveView
    try {
      beforeView = getPrimitiveView(this.createFilteredPrimitives({ ...common, otherHdRoutes: beforePeers }, stats), stats)
      afterView = getPrimitiveView(this.createFilteredPrimitives({ ...common, otherHdRoutes: afterPeers }, stats), stats)
    } catch {
      return { certified: false, stats, nativeQueryError: true }
    }
    const changedLines = getChangedValues(beforeView.lines, afterView.lines)
    const changedVias = getChangedValues(beforeView.vias, afterView.vias)
    for (const query of footprint.queries) {
      if (!isOrdinaryPoint(query.start) || !isOrdinaryPoint(query.end)) return { certified: false, stats }
      if (!query.valid && query.immutableObstacleFailure) continue
      // This is the native SegmentTree's exact bucket selection. No approximate
      // distance envelope or additional floating-point broadphase is assumed.
      const queryBuckets: Bounds = {
        minX: Math.floor((Math.min(query.start.x, query.end.x) - queryMargin) / cellSize),
        minY: Math.floor((Math.min(query.start.y, query.end.y) - queryMargin) / cellSize),
        maxX: Math.floor((Math.max(query.start.x, query.end.x) + queryMargin) / cellSize),
        maxY: Math.floor((Math.max(query.start.y, query.end.y) + queryMargin) / cellSize),
      }
      for (const line of changedLines) {
        if (line.start.z !== query.start.z) continue
        stats.lineBucketTests++
        if (line.buckets.minX > queryBuckets.maxX || line.buckets.maxX < queryBuckets.minX ||
          line.buckets.minY > queryBuckets.maxY || line.buckets.maxY < queryBuckets.minY) continue
        stats.lineDistanceTests++
        let distance: number
        try {
          distance = minimumDistanceBetweenSegments({ x: query.start.x, y: query.start.y },
            { x: query.end.x, y: query.end.y }, { x: line.start.x, y: line.start.y },
            { x: line.end.x, y: line.end.y })
        } catch {
          return { certified: false, stats, nativeQueryError: true }
        }
        if (distance < obstacleMargin + traceThickness) {
          return { certified: false, stats }
        }
      }
      for (const via of changedVias) {
        stats.viaDistanceTests++
        let distance: number
        try {
          distance = pointToSegmentDistance(via, query.start, query.end)
        } catch {
          return { certified: false, stats, nativeQueryError: true }
        }
        if (distance < obstacleMargin + via.diameter / 2 + traceThickness / 2) return { certified: false, stats }
      }
    }
    return { certified: true, stats }
  }
}
