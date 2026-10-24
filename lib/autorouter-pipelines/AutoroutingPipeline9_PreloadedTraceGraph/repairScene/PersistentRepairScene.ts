import Flatbush from "flatbush"
import type { ClearancePathInput } from "@tscircuit/repair04"
import { REGION_EPSILON } from "./pipeline9RepairGeometry"
import type { RepairSceneDiagnostics } from "./RepairGeometryDistanceCache"

type Point = ClearancePathInput["start"]
type Box = { minX: number; maxX: number; minY: number; maxY: number }
export type SceneCopper = Box & {
  a: Point; b: Point; radius: number; minZ: number; maxZ: number
  spanIndex: number; index: number; cellX: number; cellY: number
  ax: number; ay: number; az: number; bx: number; by: number; bz: number
  broadMinX: number; broadMaxX: number; broadMinY: number; broadMaxY: number
}
type CopperInput = Omit<SceneCopper, "ax" | "ay" | "az" | "bx" | "by" | "bz" | "broadMinX" | "broadMaxX" | "broadMinY" | "broadMaxY">
type Entry = { keys: number[]; epoch: number; revision: number; search: number; candidates: SceneCopper[] }

/** Complete physical geometry; all selected-owner/frozen/drill policy stays live. */
export class PersistentRepairScene {
  private readonly rows: Array<Array<SceneCopper | undefined>>
  private indexed: SceneCopper[] = []
  private index?: Flatbush
  private dirty = true
  private revision = 0
  private epoch = 1
  private search = 0
  private readonly stamps = new Map<number, Map<number, number>>()
  private stampedCells = 0
  private readonly entries: Array<Entry | undefined>
  private retainedReferences = 0

  get retainedCandidateReferences(): number { return this.retainedReferences }
  get revisionCellCount(): number { return this.stampedCells }

  constructor(
    spanCount: number,
    readonly diagnostics: RepairSceneDiagnostics,
    private readonly collectWork = false,
    private readonly capacity = 16_384,
    private readonly referenceLimit = 131_072,
    private readonly cellLimit = 32_768,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 16_384 || (capacity & (capacity - 1)) !== 0) throw new Error("repair scene: candidate capacity must be a positive power of two up to 16384")
    if (!Number.isSafeInteger(referenceLimit) || referenceLimit < 0 || referenceLimit > 131_072 || !Number.isSafeInteger(cellLimit) || cellLimit < 1 || cellLimit > 32_768) throw new Error("repair scene: reference/cell limits exceed the bounded cache domain")
    this.rows = Array.from({ length: spanCount }, (): Array<SceneCopper | undefined> => [])
    this.entries = new Array(capacity)
    if (collectWork) diagnostics.workInstrumentedCaches++
    // Count reserved slots, not an engine-dependent JS heap byte estimate.
    diagnostics.candidateSlotsReserved += capacity
  }

  prepareSpan(spanIndex: number, count: number): void {
    const row = this.rows[spanIndex]!
    for (let pi = count; pi < row.length; pi++) this.removeCopper(spanIndex, pi)
    if (row.length > count) row.length = count
  }

  removeCopper(spanIndex: number, primitiveIndex: number): void {
    const row = this.rows[spanIndex]!, previous = row[primitiveIndex]
    if (!previous) return
    this.mutate(previous, undefined)
    row[primitiveIndex] = undefined
    this.diagnostics.physicalSegmentsRemoved++
  }

  setCopper(copper: CopperInput): void {
    const row = this.rows[copper.spanIndex]!, old = row[copper.index]
    const { a, b } = copper
    if (old && Object.is(old.ax, a.x) && Object.is(old.ay, a.y) && Object.is(old.az, a.z) && Object.is(old.bx, b.x) && Object.is(old.by, b.y) && Object.is(old.bz, b.z) && Object.is(old.radius, copper.radius) && old.minZ === copper.minZ && old.maxZ === copper.maxZ) {
      // Replace point references even when physical scalar values match.
      // Ownership/frozen metadata is absent from these cached primitives.
      old.a = a; old.b = b
      return
    }
    const next = { ...copper, ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, broadMinX: copper.minX - copper.radius - REGION_EPSILON, broadMaxX: copper.maxX + copper.radius + REGION_EPSILON, broadMinY: copper.minY - copper.radius - REGION_EPSILON, broadMaxY: copper.maxY + copper.radius + REGION_EPSILON }
    this.mutate(old, next)
    row[copper.index] = next
    if (old) this.diagnostics.physicalSegmentsChanged++
    else this.diagnostics.physicalSegmentsCreated++
  }

  beginSearch(): void {
    this.search++
    this.diagnostics.searches++
    if (!this.dirty) return
    this.indexed = this.rows.flatMap((row): SceneCopper[] => row.filter((item): item is SceneCopper => item !== undefined))
    this.index = this.indexed.length ? new Flatbush(this.indexed.length) : undefined
    for (const copper of this.indexed) {
      this.index!.add(copper.broadMinX, copper.broadMinY, copper.broadMaxX, copper.broadMaxY)
    }
    this.index?.finish()
    this.dirty = false
    this.diagnostics.physicalIndexBuilds++
    this.diagnostics.physicalIndexPrimitives += this.indexed.length
  }

  private resetCache(): void {
    this.epoch++
    this.entries.fill(undefined)
    this.retainedReferences = 0
    this.stamps.clear()
    this.stampedCells = 0
    this.diagnostics.candidateCacheResets++
  }

  private expandedBox(copper: SceneCopper): Box {
    return {
      minX: copper.broadMinX,
      maxX: copper.broadMaxX,
      minY: copper.broadMinY,
      maxY: copper.broadMaxY,
    }
  }

  private mutate(old: SceneCopper | undefined, next: SceneCopper | undefined): void {
    this.dirty = true
    this.revision++
    const boxes = [old, next].filter((item): item is SceneCopper => item !== undefined).map((item): Box => this.expandedBox(item))
    let cells = 0
    for (const box of boxes) cells += (Math.floor(box.maxX) - Math.floor(box.minX) + 1) * (Math.floor(box.maxY) - Math.floor(box.minY) + 1)
    const safeBounds = boxes.every((box): boolean => [box.minX, box.maxX, box.minY, box.maxY].every((value): boolean => Number.isSafeInteger(Math.floor(value))))
    if (!safeBounds || !Number.isSafeInteger(this.revision) || !Number.isSafeInteger(cells) || cells > 4096 || this.stampedCells + cells > this.cellLimit) {
      // The bounded table is a cache only. Clearing it preserves the exact
      // common-index query after arbitrarily large old/new footprints.
      this.resetCache()
      if (!Number.isSafeInteger(this.revision)) this.revision = 0
      return
    }
    for (const box of boxes) {
      const minX = Math.floor(box.minX), minY = Math.floor(box.minY)
      const width = Math.floor(box.maxX) - minX + 1, height = Math.floor(box.maxY) - minY + 1
      for (let ix = 0; ix < width; ix++) {
        const x = minX + ix
        let column = this.stamps.get(x)
        if (!column) { column = new Map(); this.stamps.set(x, column) }
        for (let iy = 0; iy < height; iy++) {
          const y = minY + iy
          if (!column.has(y)) this.stampedCells++
          column.set(y, this.revision)
        }
      }
    }
  }

  private queryRevision(box: Box): number {
    const count = (Math.floor(box.maxX) - Math.floor(box.minX) + 1) * (Math.floor(box.maxY) - Math.floor(box.minY) + 1)
    // A large query sees every mutation conservatively, with bounded work.
    if (![box.minX, box.maxX, box.minY, box.maxY].every((value): boolean => Number.isSafeInteger(Math.floor(value))) || !Number.isSafeInteger(count) || count > 4096) return this.revision
    let revision = 0
    const minX = Math.floor(box.minX), minY = Math.floor(box.minY)
    const width = Math.floor(box.maxX) - minX + 1, height = Math.floor(box.maxY) - minY + 1
    for (let ix = 0; ix < width; ix++) for (let iy = 0; iy < height; iy++) {
      if (this.collectWork) this.diagnostics.revisionCellsVisited++
      revision = Math.max(revision, this.stamps.get(minX + ix)?.get(minY + iy) ?? 0)
    }
    return revision
  }

  query(a: Point, b: Point, reach: number): readonly SceneCopper[] {
    if (this.dirty) throw new Error("repair scene: beginSearch must publish physical changes before querying")
    if (this.collectWork) this.diagnostics.candidateQueries++
    const box = { minX: Math.min(a.x, b.x) - reach - REGION_EPSILON, minY: Math.min(a.y, b.y) - reach - REGION_EPSILON, maxX: Math.max(a.x, b.x) + reach + REGION_EPSILON, maxY: Math.max(a.y, b.y) + reach + REGION_EPSILON }
    // Cache an enclosing physical query, rather than an individual directed
    // edge. Power-of-two tiles introduce no approximate membership: the exact
    // original Flatbush AABB predicate filters every returned primitive below.
    let envelope = { minX: Math.floor(box.minX * 4) / 4, minY: Math.floor(box.minY * 4) / 4, maxX: (Math.floor(box.maxX * 4) + 1) / 4, maxY: (Math.floor(box.maxY * 4) + 1) / 4 }
    if (!Number.isFinite(envelope.minX) || !Number.isFinite(envelope.minY) || !Number.isFinite(envelope.maxX) || !Number.isFinite(envelope.maxY) || envelope.minX > box.minX || envelope.minY > box.minY || envelope.maxX < box.maxX || envelope.maxY < box.maxY) envelope = box
    const revision = this.queryRevision(envelope)
    let hash = Math.imul((envelope.minX * 4) | 0, 0x9e3779b1) ^ Math.imul((envelope.minY * 4) | 0, 0x85ebca6b)
    hash = Math.imul(hash ^ ((envelope.maxX * 4) | 0), 0xc2b2ae35) ^ Math.imul((envelope.maxY * 4) | 0, 0x27d4eb2d)
    hash ^= hash >>> 16
    const slot = hash & (this.capacity - 1), entry = this.entries[slot]
    if (entry && entry.epoch === this.epoch && Object.is(entry.keys[0], envelope.minX) && Object.is(entry.keys[1], envelope.minY) && Object.is(entry.keys[2], envelope.maxX) && Object.is(entry.keys[3], envelope.maxY)) {
      if (entry.revision === revision) {
        if (this.collectWork) {
          this.diagnostics.candidateCacheHits++
          if (entry.search !== this.search) this.diagnostics.crossSearchCandidateHits++
          entry.search = this.search
        }
        return this.filterExact(entry.candidates, box)
      }
      if (this.collectWork) this.diagnostics.candidateInvalidations++
    }
    if (this.collectWork) this.diagnostics.nativeBroadphaseQueries++
    const candidates = (this.index?.search(envelope.minX, envelope.minY, envelope.maxX, envelope.maxY) ?? []).map((index): SceneCopper => this.indexed[index]!)
    if (this.collectWork) this.diagnostics.broadphaseCandidatesReturned += candidates.length
    if (entry) this.retainedReferences -= entry.candidates.length
    if (candidates.length > 4096 || candidates.length > this.referenceLimit) {
      this.entries[slot] = undefined
      return this.filterExact(candidates, box)
    }
    if (this.retainedReferences + candidates.length > this.referenceLimit) this.resetCache()
    else if (entry && this.collectWork) this.diagnostics.candidateEvictions++
    this.entries[slot] = { keys: [envelope.minX, envelope.minY, envelope.maxX, envelope.maxY], epoch: this.epoch, revision: this.queryRevision(envelope), search: this.search, candidates }
    this.retainedReferences += candidates.length
    return this.filterExact(candidates, box)
  }

  private filterExact(candidates: readonly SceneCopper[], box: Box): SceneCopper[] {
    const exact: SceneCopper[] = []
    for (const copper of candidates) {
      if (this.collectWork) this.diagnostics.candidateBboxChecks++
      if (copper.broadMinX <= box.maxX && copper.broadMaxX >= box.minX && copper.broadMinY <= box.maxY && copper.broadMaxY >= box.minY) exact.push(copper)
    }
    return exact
  }
}
