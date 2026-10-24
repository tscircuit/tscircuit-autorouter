import type { ClearancePathInput } from "@tscircuit/repair04"

type Point = ClearancePathInput["start"]
type PotentialNode = {
  value: number
  beforeSearch: number
  changedDuringSearch: number
  queued: boolean
}
type GridDomain = {
  nx: number
  ny: number
  layers: number
  grid: number
  minX: number
  minY: number
  end: Point
  allowLayerChanges: boolean
}

export type IncrementalRepairCounters = {
  aggregateWork: number
  rollbackSnapshotsComplete: number
  preOwnershipUnknowns: number
  ownedRollbackUnknowns: number
  nativeHeapPops: number
  fingerprintValues: number
  fingerprintCharacters: number
  ownedValuesCopied: number
  fixedRouteGuards: number
  gridCoordinateChecks: number
  workspaceHits: number
  workspaceMisses: number
  workspaceEvictions: number
  signatureResets: number
  retainedNodeCount: number
  retainedRejectionCount: number
  peakRetainedEntries: number
  nodeConstructions: number
  blockedEdgeObservations: number
  directedRejectionInsertions: number
  bidirectionalCertificates: number
  predecessorScans: number
  bellmanBackups: number
  bellmanLabelIncreases: number
  queuePushes: number
  queuePops: number
  heuristicReads: number
  strongerHeuristicReads: number
  hardOracleCalls: number
  capacityDrops: number
  workLimitStops: number
  domainLimitStops: number
}

/** A budget stop is an explicit unknown path result, never an infeasibility proof. */
export class IncrementalRepairWorkLimit extends Error {
  constructor(readonly reason: "aggregate-work-limit" | "retained-domain-limit" = "aggregate-work-limit") {
    super(
      `Pipeline9 incremental repair bounded unknown: ${reason}`,
    )
    this.name = "IncrementalRepairWorkLimit"
  }
}

/** Counts native pops and every added graph/fingerprint/proof operation together. */
export class IncrementalRepairWorkBudget {
  readonly counters: IncrementalRepairCounters = {
    aggregateWork: 0, rollbackSnapshotsComplete: 0, preOwnershipUnknowns: 0, ownedRollbackUnknowns: 0, nativeHeapPops: 0, fingerprintValues: 0,
    fingerprintCharacters: 0, ownedValuesCopied: 0, fixedRouteGuards: 0, gridCoordinateChecks: 0, workspaceHits: 0, workspaceMisses: 0,
    workspaceEvictions: 0, signatureResets: 0, retainedNodeCount: 0,
    retainedRejectionCount: 0, peakRetainedEntries: 0, nodeConstructions: 0,
    blockedEdgeObservations: 0, directedRejectionInsertions: 0, bidirectionalCertificates: 0, predecessorScans: 0,
    bellmanBackups: 0, bellmanLabelIncreases: 0, queuePushes: 0, queuePops: 0,
    heuristicReads: 0, strongerHeuristicReads: 0, hardOracleCalls: 0,
    capacityDrops: 0, workLimitStops: 0, domainLimitStops: 0,
  }

  constructor(readonly maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum < 0) {
      throw new Error("Incremental repair requires a finite nonnegative work cap")
    }
  }

  charge(units = 1): void {
    if (!Number.isSafeInteger(units) || units < 0) {
      throw new Error("Incremental repair work charges must be nonnegative integers")
    }
    if (units > this.maximum - this.counters.aggregateWork) {
      this.counters.workLimitStops++
      throw new IncrementalRepairWorkLimit()
    }
    this.counters.aggregateWork += units
  }
}

/**
 * Exact typed serialization is performed once per failed existing-path replay.
 * It distinguishes signed zero/nonfinite numbers and inspects values, not identities.
 */
function fingerprint(value: unknown, work: IncrementalRepairWorkBudget): string {
  work.charge()
  work.counters.fingerprintValues++
  if (value === null) return "null;"
  if (value === undefined) return "undefined;"
  if (typeof value === "number") {
    return `number:${Object.is(value, -0) ? "-0" : String(value)};`
  }
  if (typeof value === "boolean") return `boolean:${value};`
  if (typeof value === "string") {
    work.charge(Math.ceil(value.length / 64))
    work.counters.fingerprintCharacters += value.length
    return `string:${JSON.stringify(value)};`
  }
  if (Array.isArray(value)) {
    return `array:[${value.map((entry) => fingerprint(entry, work)).join("")}]`
  }
  if (typeof value !== "object") {
    throw new Error("Incremental hard-space domain contains an unsupported value")
  }
  return `object:{${Object.keys(value).map((key) =>
    `${fingerprint(key, work)}${fingerprint((value as Record<string, unknown>)[key], work)}`,
  ).join("")}}`
}

/** Copies and freezes the actual objects consumed by the native child. */
export function copyOwnedRepairValue<T>(value: T, work: IncrementalRepairWorkBudget, freeze = true): T {
  work.charge()
  work.counters.ownedValuesCopied++
  if (value === null || typeof value !== "object") return value
  const output = Array.isArray(value)
    ? value.map((entry) => copyOwnedRepairValue(entry, work, freeze))
    : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copyOwnedRepairValue(entry, work, freeze)]))
  if (freeze) Object.freeze(output)
  return output as T
}

/** Internal spans are frozen before registration, not trusted by identity alone. */
function freezeOwnedRepairValue(value: unknown, work: IncrementalRepairWorkBudget): void {
  work.charge()
  if (value === null || typeof value !== "object") return
  for (const entry of Object.values(value)) freezeOwnedRepairValue(entry, work)
  // This function is used only on privately constructed native fixed spans.
  // Caller-owned source SRJ/routes were already copied before native setup.
  Object.freeze(value)
}

/** Verify the actual nested objects before accepting an owned immutable scene. */
function assertDeepFrozenRepairValue(value: unknown, work: IncrementalRepairWorkBudget): void {
  work.charge()
  if (value === null || typeof value !== "object") return
  if (!Object.isFrozen(value)) {
    throw new Error("Incremental repair owned scene is not deeply immutable")
  }
  for (const entry of Object.values(value)) assertDeepFrozenRepairValue(entry, work)
}

/**
 * A partial Bellman lower-bound field on the native raster graph. Unknown edges
 * have only their geometric cost. Both ordered native continuum queries must
 * have independently rejected an edge before it becomes blocked here.
 * Cached unordered rejections never enter this observer. Congestion and path drill history
 * are omitted from this relaxation and remain in the fresh native search.
 */
export class RetainedHardSpacePotential {
  private readonly nodes = new Map<number, PotentialNode>()
  private readonly blocked = new Map<number, Set<number>>()
  private readonly pending: number[] = []
  private pendingCursor = 0
  private search = 0
  private entries = 0
  private readonly plane: number
  readonly count: number

  constructor(
    readonly domain: GridDomain,
    readonly work: IncrementalRepairWorkBudget,
    private readonly entryLimit = 16384,
  ) {
    this.work.charge(Object.keys(domain).length + Object.keys(domain.end).length + 1)
    this.domain = Object.freeze({ ...domain, end: Object.freeze({ ...domain.end }) })
    this.plane = domain.nx * domain.ny
    this.count = this.plane * domain.layers
    if (!Number.isSafeInteger(this.count) || this.count < 1) {
      throw new Error("Retained potential requires the native finite grid domain")
    }
    for (const [minimum, size] of [[domain.minX, domain.nx], [domain.minY, domain.ny]]) {
      for (let index = 0; index < size!; index++) {
        this.work.charge()
        this.work.counters.gridCoordinateChecks++
        const coordinate = minimum! + (index + 0.5) * domain.grid
        if (!Number.isFinite(coordinate) || Math.floor((coordinate - minimum!) / domain.grid) !== index) {
          this.work.counters.domainLimitStops++
          throw new IncrementalRepairWorkLimit("retained-domain-limit")
        }
      }
    }
  }

  beginSearch(): void {
    this.work.charge()
    if (this.search > 0) this.repair(64)
    this.search++
    // Native priorities read the pre-search field. New observations improve the
    // NEXT search, so no queued native entry silently changes its heuristic.
    if (!Number.isSafeInteger(this.search)) {
      throw new Error("Retained potential search generation overflow")
    }
  }

  get warm(): boolean {
    // First-use tasks collect only compact blocked-edge certificates. They do
    // not eagerly allocate a value for every successful native neighbor.
    // Later occurrences inherit the repaired lower-bound field.
    return this.search > 1
  }

  private point(id: number): Point {
    this.work.charge()
    return {
      x: this.domain.minX + ((id % this.domain.nx) + 0.5) * this.domain.grid,
      y: this.domain.minY + ((Math.floor(id / this.domain.nx) % this.domain.ny) + 0.5) * this.domain.grid,
      z: Math.floor(id / this.plane),
    }
  }

  private baseline(id: number): number {
    const point = this.point(id)
    return Math.hypot(point.x - this.domain.end.x, point.y - this.domain.end.y) +
      (point.z === this.domain.end.z ? 0 : 1)
  }

  private node(id: number): PotentialNode | undefined {
    this.work.charge()
    const previous = this.nodes.get(id)
    if (previous) return previous
    if (this.entries === this.entryLimit) {
      this.work.counters.capacityDrops++
      return undefined
    }
    const value = this.baseline(id)
    const result = { value, beforeSearch: value, changedDuringSearch: this.search, queued: false }
    this.nodes.set(id, result)
    this.entries++
    this.work.counters.nodeConstructions++
    this.work.counters.retainedNodeCount++
    this.work.counters.peakRetainedEntries = Math.max(this.work.counters.peakRetainedEntries,
      this.work.counters.retainedNodeCount + this.work.counters.retainedRejectionCount)
    return result
  }

  private enqueue(id: number): void {
    this.work.charge()
    const node = this.nodes.get(id)
    if (!node || node.queued) return
    node.queued = true
    this.pending.push(id)
    this.work.counters.queuePushes++
  }

  private neighbors(id: number): number[] {
    const result: number[] = []
    const x = id % this.domain.nx
    const y = Math.floor(id / this.domain.nx) % this.domain.ny
    const z = Math.floor(id / this.plane)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      this.work.charge()
      if ((!dx && !dy) || x + dx < 0 || x + dx >= this.domain.nx ||
        y + dy < 0 || y + dy >= this.domain.ny) continue
      result.push((z * this.domain.ny + y + dy) * this.domain.nx + x + dx)
    }
    if (this.domain.allowLayerChanges) for (let layer = 0; layer < this.domain.layers; layer++) {
      this.work.charge()
      if (layer !== z) result.push(layer * this.plane + id % this.plane)
    }
    return result
  }

  observeFreshHardRejection(a: Point, b: Point): void {
    this.work.charge()
    this.work.counters.blockedEdgeObservations++
    const ids = [a, b].map((point): number | undefined => {
      const x = Math.floor((point.x - this.domain.minX) / this.domain.grid)
      const y = Math.floor((point.y - this.domain.minY) / this.domain.grid)
      const id = (point.z * this.domain.ny + y) * this.domain.nx + x
      if (x < 0 || x >= this.domain.nx || y < 0 || y >= this.domain.ny ||
        !Number.isInteger(point.z) || point.z < 0 || point.z >= this.domain.layers) return undefined
      const nativePoint = this.point(id)
      return nativePoint.x === point.x && nativePoint.y === point.y ? id : undefined
    })
    const [left, right] = ids
    if (left === undefined || right === undefined || left === right) return
    const ordinary = Math.floor(left / this.plane) === Math.floor(right / this.plane) &&
      Math.abs(left % this.domain.nx - right % this.domain.nx) <= 1 &&
      Math.abs(Math.floor(left / this.domain.nx) % this.domain.ny - Math.floor(right / this.domain.nx) % this.domain.ny) <= 1
    const transition = this.domain.allowLayerChanges && left % this.plane === right % this.plane
    if (!ordinary && !transition) return
    let edges = this.blocked.get(left)
    if (edges?.has(right)) return
    if (this.entries === this.entryLimit) { this.work.counters.capacityDrops++; return }
    if (!edges) { edges = new Set<number>(); this.blocked.set(left, edges) }
    edges.add(right)
    this.entries++
    this.work.counters.directedRejectionInsertions++
    this.work.counters.retainedRejectionCount++
    this.work.counters.peakRetainedEntries = Math.max(this.work.counters.peakRetainedEntries,
      this.work.counters.retainedNodeCount + this.work.counters.retainedRejectionCount)
    // One orientation may fail only because of rounding. Native uses unordered
    // caching, so either orientation might be evaluated first on the next call.
    // Only two independent raw rejections certify a blocked relaxed edge.
    if (this.blocked.get(right)?.has(left)) {
      this.work.counters.bidirectionalCertificates++
      this.node(left)
      this.node(right)
      this.enqueue(left)
      this.enqueue(right)
    }
  }

  /** Bounded asynchronous Bellman backups always preserve a lower bound. */
  repair(maximumPops: number): void {
    let popped = 0
    while (this.pendingCursor < this.pending.length && popped++ < maximumPops) {
      this.work.charge()
      const id = this.pending[this.pendingCursor++]!
      const node = this.nodes.get(id)!
      node.queued = false
      this.work.counters.queuePops++
      this.work.counters.bellmanBackups++
      const point = this.point(id)
      let best = point.z === this.domain.end.z &&
        Math.hypot(point.x - this.domain.end.x, point.y - this.domain.end.y) < this.domain.grid * 3
        ? Math.hypot(point.x - this.domain.end.x, point.y - this.domain.end.y) : Infinity
      const neighbors = this.neighbors(id)
      for (const neighbor of neighbors) {
        this.work.charge()
        this.work.counters.predecessorScans++
        if (this.blocked.get(id)?.has(neighbor) && this.blocked.get(neighbor)?.has(id)) continue
        const other = this.point(neighbor)
        const edge = point.z === other.z ? Math.hypot(point.x - other.x, point.y - other.y) : 1
        const remaining = this.nodes.get(neighbor)?.value ?? this.baseline(neighbor)
        const sum = edge + remaining
        // Downward slack is a cost-bound rounding guard, never extra clearance.
        const lower = sum - 8 * Number.EPSILON * (Math.abs(edge) + Math.abs(remaining) + 1)
        best = Math.min(best, lower)
      }
      // A finite ceiling prevents count-to-infinity in disconnected components.
      const ceiling = 16 * (this.domain.nx + this.domain.ny) * this.domain.grid + this.domain.layers
      const next = Math.min(best, ceiling)
      if (next > node.value) {
        if (node.changedDuringSearch !== this.search) {
          node.beforeSearch = node.value
          node.changedDuringSearch = this.search
        }
        node.value = next
        this.work.counters.bellmanLabelIncreases++
        for (const predecessor of neighbors) this.enqueue(predecessor)
      }
    }
    if (this.pendingCursor >= 4096 && this.pendingCursor * 2 >= this.pending.length) {
      this.work.charge(this.pending.length - this.pendingCursor + 1)
      this.pending.splice(0, this.pendingCursor)
      this.pendingCursor = 0
    }
    if (this.pendingCursor === this.pending.length) {
      this.pending.length = 0
      this.pendingCursor = 0
    }
  }

  heuristic(id: number, nativeBaseline?: number): number {
    this.work.charge()
    this.work.counters.heuristicReads++
    const baseline = nativeBaseline === undefined ? this.baseline(id) : nativeBaseline
    let node = this.nodes.get(id)
    if (!node && this.entries < this.entryLimit) {
      this.work.charge()
      node = { value: baseline, beforeSearch: baseline, changedDuringSearch: this.search, queued: false }
      this.nodes.set(id, node)
      this.entries++
      this.work.counters.nodeConstructions++
      this.work.counters.retainedNodeCount++
      this.work.counters.peakRetainedEntries = Math.max(this.work.counters.peakRetainedEntries,
        this.work.counters.retainedNodeCount + this.work.counters.retainedRejectionCount)
    }
    if (!node) return baseline
    const value = node.changedDuringSearch === this.search ? node.beforeSearch : node.value
    if (value > baseline) this.work.counters.strongerHeuristicReads++
    return value
  }

  release(): void {
    this.work.charge(this.entries + this.pending.length)
    this.work.counters.retainedNodeCount -= this.nodes.size
    this.work.counters.retainedRejectionCount -= this.entries - this.nodes.size
    this.nodes.clear()
    this.blocked.clear()
    this.pending.length = 0
  }
}

/** Bounded per-negotiation task registry; every lookup validates actual values. */
export class RetainedHardSpacePotentials {
  private readonly workspaces = new Map<string, RetainedHardSpacePotential>()
  private ownedSrj?: ClearancePathInput["srj"]
  private readonly fixedRoutes: ClearancePathInput["routes"] = []
  private fixedEpoch = 0

  constructor(readonly work: IncrementalRepairWorkBudget) {
    // An unbound registry validates a full value signature on every open.
    // The production negotiation binds its copied, frozen scene below.
    // Both modes use the same retained Bellman kernel and work allowance.
    // No opaque cost callback is cached by either mode.
  }

  bindOwnedSrj(srj: ClearancePathInput["srj"]): void {
    this.work.charge()
    if (this.ownedSrj || !Object.isFrozen(srj)) {
      throw new Error("Incremental repair requires one copied immutable SRJ scene")
    }
    assertDeepFrozenRepairValue(srj, this.work)
    this.ownedSrj = srj
  }

  registerFixedRoute(route: ClearancePathInput["routes"][number]): void {
    freezeOwnedRepairValue(route, this.work)
    this.work.charge()
    this.fixedRoutes.push(route)
    this.fixedEpoch++
    if (!Number.isSafeInteger(this.fixedEpoch)) {
      throw new Error("Incremental repair fixed-scene version overflow")
    }
  }

  open(input: ClearancePathInput, grid: number): RetainedHardSpacePotential | undefined {
    const nx = Math.floor((input.bounds.maxX - input.bounds.minX) / grid)
    const ny = Math.floor((input.bounds.maxY - input.bounds.minY) / grid)
    const count = nx * ny * input.srj.layerCount
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(input.srj.layerCount) ||
      input.srj.layerCount < 1 || nx <= 0 || ny <= 0 || count < 1 || count > 1000000 ||
      !Number.isInteger(input.start.z) || !Number.isInteger(input.end.z) ||
      input.start.z < 0 || input.start.z >= input.srj.layerCount ||
      input.end.z < 0 || input.end.z >= input.srj.layerCount) {
      this.work.counters.domainLimitStops++
      throw new IncrementalRepairWorkLimit("retained-domain-limit")
    }
    const route = input.routes[input.routeIndex]!
    if (this.ownedSrj) {
      if (input.srj !== this.ownedSrj || input.routes.length !== this.fixedRoutes.length + 1 || input.routeIndex !== this.fixedRoutes.length) {
        throw new Error("Incremental repair child changed its owned hard-scene namespace")
      }
      for (let index = 0; index < this.fixedRoutes.length; index++) {
        this.work.charge()
        this.work.counters.fixedRouteGuards++
        if (input.routes[index] !== this.fixedRoutes[index] || !Object.isFrozen(input.routes[index])) {
          throw new Error("Incremental repair fixed route escaped its immutable scene")
        }
      }
    }
    const signature = fingerprint({
      scene: this.ownedSrj ? this.fixedEpoch : input.srj,
      fixedRoutes: this.ownedSrj ? undefined : input.routes.filter((_, index) => index !== input.routeIndex),
      selected: { connectionName: route.connectionName, rootConnectionName: route.rootConnectionName,
        viaDiameter: route.viaDiameter, traceThickness: route.traceThickness },
      start: input.start, end: input.end, bounds: input.bounds, grid,
      traceThickness: input.traceThickness, traceClearance: input.traceClearance,
      viaClearance: input.viaClearance, viaHoleDiameter: input.viaHoleDiameter,
      allowLayerChanges: input.allowLayerChanges,
    }, this.work)
    if (signature.length > 2000000) {
      this.work.counters.domainLimitStops++
      throw new IncrementalRepairWorkLimit("retained-domain-limit")
    }
    const previous = this.workspaces.get(signature)
    if (previous) {
      this.work.counters.workspaceHits++
      this.workspaces.delete(signature)
      this.workspaces.set(signature, previous)
      previous.beginSearch()
      return previous
    }
    this.work.counters.workspaceMisses++
    if (this.workspaces.size === 64) {
      const key = this.workspaces.keys().next().value!
      this.workspaces.get(key)!.release()
      this.workspaces.delete(key)
      this.work.counters.workspaceEvictions++
    }
    this.work.charge()
    const result = new RetainedHardSpacePotential({ nx, ny, layers: input.srj.layerCount,
      grid, minX: input.bounds.minX, minY: input.bounds.minY, end: input.end,
      allowLayerChanges: input.allowLayerChanges !== false }, this.work)
    this.workspaces.set(signature, result)
    result.beginSearch()
    return result
  }
}
