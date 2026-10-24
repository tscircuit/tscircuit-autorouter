import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"

type Point = { x: number; y: number }
export type PhysicalSegment = { id: number; ax: number; ay: number; bx: number; by: number }
export type RepairSceneDiagnostics = {
  searches: number
  workInstrumentedCaches: number
  physicalSegmentsCreated: number
  physicalSegmentsChanged: number
  physicalSegmentsRemoved: number
  distanceLookups: number
  distanceHits: number
  crossSearchDistanceHits: number
  nativeDistanceEvaluations: number
  distanceEvictions: number
  distanceTableAllocatedBytes: number
  physicalIndexBuilds: number
  physicalIndexPrimitives: number
  candidateQueries: number
  revisionCellsVisited: number
  candidateBboxChecks: number
  candidateCacheHits: number
  crossSearchCandidateHits: number
  nativeBroadphaseQueries: number
  broadphaseCandidatesReturned: number
  candidateInvalidations: number
  candidateEvictions: number
  candidateCacheResets: number
  candidateSlotsReserved: number
}

export function createRepairSceneDiagnostics(): RepairSceneDiagnostics {
  return {
    searches: 0,
    workInstrumentedCaches: 0,
    physicalSegmentsCreated: 0,
    physicalSegmentsChanged: 0,
    physicalSegmentsRemoved: 0,
    distanceLookups: 0,
    distanceHits: 0,
    crossSearchDistanceHits: 0,
    nativeDistanceEvaluations: 0,
    distanceEvictions: 0,
    distanceTableAllocatedBytes: 0,
    physicalIndexBuilds: 0,
    physicalIndexPrimitives: 0,
    candidateQueries: 0,
    revisionCellsVisited: 0,
    candidateBboxChecks: 0,
    candidateCacheHits: 0,
    crossSearchCandidateHits: 0,
    nativeBroadphaseQueries: 0,
    broadphaseCandidatesReturned: 0,
    candidateInvalidations: 0,
    candidateEvictions: 0,
    candidateCacheResets: 0,
    candidateSlotsReserved: 0,
  }
}

/**
 * Bounded demand-driven raw geometry, shared by one sequential negotiation.
 * The native filtered index and all policy/clearance tests remain outside this
 * cache. Segment generations copy coordinates by value, including mutations of
 * existing point objects. Width, layers, owner and prices never enter a stored
 * result: the exact native distance primitive reads only the four x/y points.
 */
export class RepairGeometryDistanceCache {
  private readonly segments: Array<Array<PhysicalSegment | undefined>>
  private keys?: Float64Array
  private values?: Float64Array
  private searches?: Float64Array
  private nextId = 1
  private search = 0

  constructor(
    spanCount: number,
    readonly diagnostics: RepairSceneDiagnostics,
    private readonly capacity = 65_536,
    private readonly collectWork = false,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 65_536 || (capacity & (capacity - 1)) !== 0) {
      throw new Error("repair scene: distance capacity must be a power of two up to 65536")
    }
    if (collectWork) diagnostics.workInstrumentedCaches++
    this.segments = Array.from({ length: spanCount }, (): Array<PhysicalSegment | undefined> => [])
  }

  beginSearch(): void {
    this.search++
    this.diagnostics.searches++
  }

  beginSpan(spanIndex: number, segmentCount: number): void {
    const row = this.segments[spanIndex]!
    for (let index = segmentCount; index < row.length; index++) {
      if (row[index]) this.diagnostics.physicalSegmentsRemoved++
    }
    if (row.length > segmentCount) row.length = segmentCount
  }

  getSegment(spanIndex: number, segmentIndex: number, a: Point, b: Point): PhysicalSegment {
    const row = this.segments[spanIndex]!
    let segment = row[segmentIndex]
    if (!segment) {
      segment = { id: this.nextId++, ax: a.x, ay: a.y, bx: b.x, by: b.y }
      row[segmentIndex] = segment
      this.diagnostics.physicalSegmentsCreated++
    }
    this.refresh(segment, a, b)
    return segment
  }

  private refresh(segment: PhysicalSegment, a: Point, b: Point): void {
    if (Object.is(segment.ax, a.x) && Object.is(segment.ay, a.y) && Object.is(segment.bx, b.x) && Object.is(segment.by, b.y)) return
    segment.id = this.nextId++
    segment.ax = a.x
    segment.ay = a.y
    segment.bx = b.x
    segment.by = b.y
    this.diagnostics.physicalSegmentsChanged++
  }

  distance(segment: PhysicalSegment, a: Point, b: Point, u: Point, v: Point): number {
    if (this.collectWork) this.diagnostics.distanceLookups++
    this.refresh(segment, u, v)
    if (!this.keys) {
      this.keys = new Float64Array(this.capacity * 5)
      this.values = new Float64Array(this.capacity)
      if (this.collectWork) this.searches = new Float64Array(this.capacity)
      this.diagnostics.distanceTableAllocatedBytes += this.keys.byteLength + this.values.byteLength + (this.searches?.byteLength ?? 0)
    }
    const keys = this.keys, values = this.values!, searches = this.searches
    // Quantization is used only for choosing an eviction slot. The original
    // directed Float64 keys and geometry generation are checked on every hit.
    let hash = Math.imul((a.x * 2048) | 0, 0x9e3779b1) ^ Math.imul((a.y * 2048) | 0, 0x85ebca6b)
    hash = Math.imul(hash ^ ((b.x * 2048) | 0), 0xc2b2ae35) ^ Math.imul((b.y * 2048) | 0, 0x27d4eb2d)
    hash = Math.imul(hash ^ (segment.id | 0), 0x165667b1)
    hash ^= hash >>> 16
    const slot = hash & (this.capacity - 1)
    const offset = slot * 5
    if (
      keys[offset] === segment.id &&
      Object.is(keys[offset + 1], a.x) && Object.is(keys[offset + 2], a.y) &&
      Object.is(keys[offset + 3], b.x) && Object.is(keys[offset + 4], b.y)
    ) {
      if (this.collectWork) {
        this.diagnostics.distanceHits++
        if (searches![slot] !== this.search) this.diagnostics.crossSearchDistanceHits++
        searches![slot] = this.search
      }
      return values[slot]!
    }
    if (this.collectWork) this.diagnostics.nativeDistanceEvaluations++
    const value = segmentToSegmentMinDistance(a, b, u, v)
    if (!Number.isSafeInteger(segment.id) || Number.isNaN(value)) return value
    if (this.collectWork && keys[offset] !== 0) this.diagnostics.distanceEvictions++
    keys[offset] = segment.id
    keys[offset + 1] = a.x
    keys[offset + 2] = a.y
    keys[offset + 3] = b.x
    keys[offset + 4] = b.y
    values[slot] = value
    if (this.collectWork) searches![slot] = this.search
    return value
  }
}
