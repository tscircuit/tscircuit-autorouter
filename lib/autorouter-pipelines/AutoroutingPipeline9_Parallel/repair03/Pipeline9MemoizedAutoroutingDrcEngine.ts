/**
 * Exact prototype derivative of high-density-repair03 at
 * e16df6c48efed49406cf45df49fd933d3141973d (MIT, see ./LICENSE).
 * Keep broad-phase traversal, live connectivity guards, error objects and run
 * counters unchanged; memoize only pure geometry checks that proved clear.
 */
import {
  getBoundsFromPoints,
  getSegmentIntersection,
  pointToSegmentClosestPoint,
  segmentToBoundsMinDistance,
  segmentToCircleMinDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  applyToPoint,
  applyToPoints,
  compose,
  inverse,
  type Matrix,
  rotateDEG,
  translate,
} from "transformation-matrix"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "high-density-repair03/lib/types"
import { getViaDrillLayers } from "high-density-repair03/lib/utils/getViaLayers"

type Point = { x: number; y: number }

type Bounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type DynamicIndexSnapshot = {
  segmentCount: number
  viaCount: number
  cellBounds: Float64Array
  segmentLayers: string[]
  viaLayers: string[][]
}

type WireRoutePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "wire" }
>

type TraceSegment = {
  kind: "trace_segment"
  order: number
  traceId: string
  netId: string
  start: Point
  end: Point
  width: number
  layer: string
  pcbPortIds: string[]
  geometryIdentity: object
}

type Via = {
  kind: "via"
  order: number
  viaId: string
  traceId: string
  netId: string
  x: number
  y: number
  diameter: number
  layers: string[]
  geometryIdentity: object
}

type StaticObstacle = {
  kind: "obstacle"
  obstacleType: "pcb_smtpad" | "pcb_plated_hole"
  obstacleId: string
  connectedTo: string[]
  x: number
  y: number
  width: number
  height: number
  radius?: number
  localToWorld: Matrix
  worldToLocal: Matrix
  layers: string[]
  pcbPortId?: string
}

type DynamicCollidable = TraceSegment | Via

type GeometrySnapshot = {
  kind: string
  aX: number
  aY: number
  bX: number
  bY: number
  size: number
  identity: object
}

export type AutoroutingDrcError = {
  type:
    | "pcb_trace_error"
    | "pcb_via_clearance_error"
    | "pcb_pad_pad_clearance_error"
  error_type:
    | "pcb_trace_error"
    | "pcb_via_clearance_error"
    | "pcb_pad_pad_clearance_error"
  message: string
  center?: Point
  pcb_center?: Point
  pcb_via_pair_net_relation?: "same_net" | "different_net"
  [key: string]: unknown
}

export interface AutoroutingDrcResult {
  errors: AutoroutingDrcError[]
  errorsWithCenters: AutoroutingDrcError[]
  locationAwareErrors: Array<AutoroutingDrcError & { center: Point }>
}

export interface AutoroutingDrcEngineOptions {
  /**
   * Copper-edge clearance used for trace-to-trace, trace-to-via, and
   * trace-to-obstacle checks.
   */
  traceClearance?: number
  /**
   * Copper-edge clearance used for both same-net and different-net via pairs.
   * Values below 0.1 mm are clamped to the repair solver's safety minimum.
   */
  viaClearance?: number
  /** Copper-edge clearance used for via-to-pad checks. */
  viaToPadClearance?: number
  /**
   * Optional broad-phase cell size. The engine derives one from the board
   * bounds when this is omitted.
   */
  spatialCellSize?: number
  /**
   * Optional connectivity map for designs whose equivalent net identifiers
   * are not fully represented by the SRJ connection metadata.
   */
  connMap?: ConnectivityMap
  /**
   * Include explicit trace/via owner ids for preload-aware repair targeting.
   * Defaults to false so legacy callers receive the original error shape.
   */
  includeTraceViaOwnerMetadata?: boolean
}

export interface AutoroutingDrcEngineRunStats {
  traceCount: number
  segmentCount: number
  viaCount: number
  obstacleCount: number
  broadPhaseCandidateCount: number
  exactCheckCount: number
}

const DEFAULT_TRACE_CLEARANCE = 0.1
const MIN_VIA_CLEARANCE = 0.1
const DEFAULT_VIA_TO_PAD_CLEARANCE = 0.1
const DRC_EPSILON = 5e-3
const POSITION_EPSILON = 1e-6

const expandBounds = (bounds: Bounds, amount: number): Bounds => ({
  minX: bounds.minX - amount,
  minY: bounds.minY - amount,
  maxX: bounds.maxX + amount,
  maxY: bounds.maxY + amount,
})

const getSegmentBounds = (segment: TraceSegment): Bounds =>
  expandBounds(
    {
      minX: Math.min(segment.start.x, segment.end.x),
      minY: Math.min(segment.start.y, segment.end.y),
      maxX: Math.max(segment.start.x, segment.end.x),
      maxY: Math.max(segment.start.y, segment.end.y),
    },
    segment.width / 2,
  )

const getViaBounds = (via: Via): Bounds => {
  const radius = via.diameter / 2
  return {
    minX: via.x - radius,
    minY: via.y - radius,
    maxX: via.x + radius,
    maxY: via.y + radius,
  }
}

const getObstacleBounds = (obstacle: StaticObstacle): Bounds =>
  getBoundsFromPoints(
    applyToPoints(obstacle.localToWorld, [
      { x: -obstacle.width / 2, y: -obstacle.height / 2 },
      { x: obstacle.width / 2, y: -obstacle.height / 2 },
      { x: obstacle.width / 2, y: obstacle.height / 2 },
      { x: -obstacle.width / 2, y: obstacle.height / 2 },
    ]),
  )!

const getObstacleLocalBounds = (obstacle: StaticObstacle): Bounds => ({
  minX: -obstacle.width / 2,
  minY: -obstacle.height / 2,
  maxX: obstacle.width / 2,
  maxY: obstacle.height / 2,
})

class SpatialHash<T> {
  private readonly cells = new Map<number, Map<number, number[]>>()
  private readonly itemIds = new Map<T, number>()
  private readonly rowItems: T[] = []
  private visitedGenerations = new Uint32Array(0)
  private queryGeneration = 0
  private readonly queryCache = new Map<string, T[]>()

  constructor(
    private readonly cellSize: number,
    private readonly cacheQueries = false,
  ) {}

  private registerItem(item: T): number {
    const existingId = this.itemIds.get(item)
    if (existingId !== undefined) return existingId

    const itemId = this.rowItems.length
    if (itemId >= this.visitedGenerations.length) {
      const generations = new Uint32Array(
        this.visitedGenerations.length === 0
          ? 16
          : this.visitedGenerations.length * 2,
      )
      generations.set(this.visitedGenerations)
      this.visitedGenerations = generations
    }
    this.itemIds.set(item, itemId)
    // Set iteration canonicalizes primitive negative zero to positive zero.
    this.rowItems.push(item === 0 ? (0 as T) : item)
    return itemId
  }

  insert(item: T, bounds: Bounds): void {
    const minCellX = Math.floor(bounds.minX / this.cellSize)
    const maxCellX = Math.floor(bounds.maxX / this.cellSize)
    const minCellY = Math.floor(bounds.minY / this.cellSize)
    const maxCellY = Math.floor(bounds.maxY / this.cellSize)
    this.insertCellRange(item, minCellX, maxCellX, minCellY, maxCellY)
  }

  insertCellRange(
    item: T,
    minCellX: number,
    maxCellX: number,
    minCellY: number,
    maxCellY: number,
  ): void {
    // Cached query arrays are valid only while cell membership is immutable.
    this.queryCache.clear()
    let itemId: number | undefined

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      let column = this.cells.get(cellX)
      if (!column && minCellY <= maxCellY) {
        column = new Map<number, number[]>()
        this.cells.set(cellX, column)
      }
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const items = column!.get(cellY)
        if (itemId === undefined) itemId = this.registerItem(item)
        if (items) {
          items.push(itemId)
        } else {
          column!.set(cellY, [itemId])
        }
      }
    }
  }

  replaceItems(replace: (item: T) => T): void {
    // Cell arrays retain their original row IDs and traversal order. Geometry
    // and metadata always come from this evaluation's freshly collected rows.
    this.itemIds.clear()
    this.queryCache.clear()
    for (let itemId = 0; itemId < this.rowItems.length; itemId++) {
      const currentItem = replace(this.rowItems[itemId]!)
      this.rowItems[itemId] = currentItem
      this.itemIds.set(currentItem, itemId)
    }
  }

  query(bounds: Bounds): T[] {
    const minCellX = Math.floor(bounds.minX / this.cellSize)
    const maxCellX = Math.floor(bounds.maxX / this.cellSize)
    const minCellY = Math.floor(bounds.minY / this.cellSize)
    const maxCellY = Math.floor(bounds.maxY / this.cellSize)
    // Unsafe/infinite endpoints must still enter the original traversal. In
    // particular, a cache hit cannot hide its nonprogressing-loop semantics.
    const cacheKey = this.cacheQueries &&
      Number.isSafeInteger(minCellX) && Number.isSafeInteger(maxCellX) &&
      Number.isSafeInteger(minCellY) && Number.isSafeInteger(maxCellY)
      ? `${minCellX},${maxCellX},${minCellY},${maxCellY}`
      : undefined
    if (cacheKey !== undefined) {
      const cached = this.queryCache.get(cacheKey)
      if (cached !== undefined) return cached
    }
    let generation = this.queryGeneration + 1
    if (generation > 0xffffffff) {
      this.visitedGenerations.fill(0)
      generation = 1
    }
    this.queryGeneration = generation
    const results: T[] = []

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      const column = this.cells.get(cellX)
      // Keep the original loop for nonprogressing infinite/unsafe endpoints.
      if (
        !column &&
        minCellY >= -9007199254740991 &&
        maxCellY <= 9007199254740991
      ) {
        continue
      }
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const items = column?.get(cellY)
        if (!items) continue
        for (const itemId of items) {
          if (this.visitedGenerations[itemId] === generation) continue
          this.visitedGenerations[itemId] = generation
          results.push(this.rowItems[itemId]!)
        }
      }
    }

    if (cacheKey !== undefined) {
      if (this.queryCache.size >= 4096) {
        this.queryCache.delete(this.queryCache.keys().next().value!)
      }
      // These arrays remain private to the engine's read-only candidate loops.
      // Returned errors are still constructed anew from live row metadata.
      this.queryCache.set(cacheKey, results)
    }
    return results
  }
}

// Internal observation metadata only: no engine construction or predicate activation.
// The authoritative class-definition snapshot stays private. Each reader receives
// fresh arrays/descriptors, so changing a returned record cannot forge provenance.
const spatialHashGetDescriptor = Object.getOwnPropertyDescriptor
const spatialHashGetPrototype = Object.getPrototypeOf
const spatialHashDefineProperty = Object.defineProperty
const spatialHashOwnKeys = Reflect.ownKeys
const spatialHashFunctionSourceDescriptor = spatialHashGetDescriptor(spatialHashGetPrototype(function () {}), "toString")
const spatialHashFunctionSourceSlot = spatialHashFunctionSourceDescriptor && spatialHashGetDescriptor(spatialHashFunctionSourceDescriptor, "value")
const spatialHashFunctionSource = spatialHashFunctionSourceSlot?.value as typeof Function.prototype.toString | undefined
const spatialHashKeys = spatialHashOwnKeys(SpatialHash.prototype)
const spatialHashDescriptors: PropertyDescriptor[] = []
for (let index = 0; index < spatialHashKeys.length; index++) {
  spatialHashDefineProperty(spatialHashDescriptors, index, { configurable: true, enumerable: true, writable: true, value: spatialHashGetDescriptor(SpatialHash.prototype, spatialHashKeys[index]!)! })
}
const spatialHashParent = spatialHashGetPrototype(SpatialHash.prototype)
export function readNativeIndexedDrcSpatialHashObservationContract(): {
  readonly object: object
  readonly parent: object | null
  readonly keys: readonly PropertyKey[]
  readonly descriptors: readonly PropertyDescriptor[]
  readonly nativeFunctionSource: typeof Function.prototype.toString | undefined
  readonly originalEngineConstructor: typeof Pipeline9MemoizedAutoroutingDrcEngine
  readonly engineDefinition: {
    readonly object: object
    readonly parent: object | null
    readonly keys: readonly PropertyKey[]
    readonly descriptors: readonly PropertyDescriptor[]
  }
  readonly engineConstructorDefinition: {
    readonly object: object
    readonly parent: object | null
    readonly keys: readonly PropertyKey[]
    readonly descriptors: readonly PropertyDescriptor[]
  }
} {
  const keys: PropertyKey[] = [], descriptors: PropertyDescriptor[] = []
  for (let index = 0; index < spatialHashKeys.length; index++) {
    spatialHashDefineProperty(keys, index, { configurable: true, enumerable: true, writable: true, value: spatialHashKeys[index]! })
    const original = spatialHashDescriptors[index]!
    spatialHashDefineProperty(descriptors, index, { configurable: true, enumerable: true, writable: true, value: {
      value: original.value,
      writable: original.writable,
      enumerable: original.enumerable,
      configurable: original.configurable,
    } })
  }
  const engineKeys: PropertyKey[] = [], engineDescriptors: PropertyDescriptor[] = []
  for (let index = 0; index < originalEngineKeys.length; index++) {
    spatialHashDefineProperty(engineKeys, index, { configurable: true, enumerable: true, writable: true, value: originalEngineKeys[index]! })
    const original = originalEngineDescriptors[index]!
    spatialHashDefineProperty(engineDescriptors, index, { configurable: true, enumerable: true, writable: true, value: {
      value: original.value,
      writable: original.writable,
      enumerable: original.enumerable,
      configurable: original.configurable,
    } })
  }
  const constructorKeys: PropertyKey[] = [], constructorDescriptors: PropertyDescriptor[] = []
  for (let index = 0; index < originalEngineConstructorKeys.length; index++) {
    spatialHashDefineProperty(constructorKeys, index, { configurable: true, enumerable: true, writable: true, value: originalEngineConstructorKeys[index]! })
    const original = originalEngineConstructorDescriptors[index]!
    spatialHashDefineProperty(constructorDescriptors, index, { configurable: true, enumerable: true, writable: true, value: {
      value: original.value, writable: original.writable, enumerable: original.enumerable, configurable: original.configurable,
    } })
  }
  return { object: SpatialHash.prototype, parent: spatialHashParent, keys, descriptors, nativeFunctionSource: spatialHashFunctionSource,
    originalEngineConstructor: Pipeline9MemoizedAutoroutingDrcEngine,
    engineDefinition: { object: originalEnginePrototype, parent: originalEngineParent, keys: engineKeys, descriptors: engineDescriptors },
    engineConstructorDefinition: { object: Pipeline9MemoizedAutoroutingDrcEngine, parent: originalEngineConstructorParent,
      keys: constructorKeys, descriptors: constructorDescriptors } }
}

const getClosestPointBetweenSegments = (
  segmentA: TraceSegment,
  segmentB: TraceSegment,
): Point => {
  const intersection = getSegmentIntersection(
    segmentA.start,
    segmentA.end,
    segmentB.start,
    segmentB.end,
  )
  if (intersection) return intersection

  const candidates = [
    {
      left: segmentA.start,
      right: pointToSegmentClosestPoint(
        segmentA.start,
        segmentB.start,
        segmentB.end,
      ),
    },
    {
      left: segmentA.end,
      right: pointToSegmentClosestPoint(
        segmentA.end,
        segmentB.start,
        segmentB.end,
      ),
    },
    {
      left: pointToSegmentClosestPoint(
        segmentB.start,
        segmentA.start,
        segmentA.end,
      ),
      right: segmentB.start,
    },
    {
      left: pointToSegmentClosestPoint(
        segmentB.end,
        segmentA.start,
        segmentA.end,
      ),
      right: segmentB.end,
    },
  ]

  let closest = {
    left: segmentA.start,
    right: segmentB.start,
  }
  let closestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const distance = Math.hypot(
      candidate.left.x - candidate.right.x,
      candidate.left.y - candidate.right.y,
    )
    if (distance < closestDistance) {
      closest = candidate
      closestDistance = distance
    }
  }

  return {
    x: (closest.left.x + closest.right.x) / 2,
    y: (closest.left.y + closest.right.y) / 2,
  }
}

const getClosestPointBetweenSegmentAndPoint = (
  segment: TraceSegment,
  point: Point,
): Point => {
  const closest = pointToSegmentClosestPoint(point, segment.start, segment.end)
  return {
    x: (closest.x + point.x) / 2,
    y: (closest.y + point.y) / 2,
  }
}

const getClosestPointBetweenSegmentAndBounds = (
  segment: TraceSegment,
  bounds: Bounds,
): Point => {
  const boundsCenter = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }
  const pointOnSegment = pointToSegmentClosestPoint(
    boundsCenter,
    segment.start,
    segment.end,
  )
  const pointOnBounds = {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, pointOnSegment.x)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, pointOnSegment.y)),
  }

  return {
    x: (pointOnSegment.x + pointOnBounds.x) / 2,
    y: (pointOnSegment.y + pointOnBounds.y) / 2,
  }
}

const getTracePortIds = (trace: SimplifiedPcbTrace) => {
  const portIds = new Set<string>()
  for (const routePoint of trace.route) {
    if (routePoint.route_type !== "wire") continue
    if (routePoint.start_pcb_port_id) {
      portIds.add(routePoint.start_pcb_port_id)
    }
    if (routePoint.end_pcb_port_id) {
      portIds.add(routePoint.end_pcb_port_id)
    }
  }
  return [...portIds]
}

const createTraceErrorMessage = (
  traceId: string,
  otherDescription: string,
  gap: number,
) =>
  gap < 0
    ? `PCB trace ${traceId} overlaps with ${otherDescription} (accidental contact)`
    : `PCB trace ${traceId} is too close to ${otherDescription} (gap: ${gap.toFixed(
        3,
      )}mm)`

/**
 * A lightweight DRC evaluator for autorouting candidate scoring.
 *
 * Static SRJ obstacle geometry and connectivity aliases are compiled once in
 * the constructor. Each evaluation builds only the route-dependent trace/via
 * broad phase and performs exact distance checks for nearby objects.
 *
 * This intentionally implements the checks used by the repair solver's
 * relaxed objective. It is not a replacement for the full-board
 * `@tscircuit/checks` validation suite.
 */
export class Pipeline9MemoizedAutoroutingDrcEngine {
  private readonly geometryIdentities = new Map<string, object>()
  private readonly previousTraceGeometry = new Map<string, Array<GeometrySnapshot | undefined>>()
  private previousGeometryCount = 0
  private clearTracePairs = new WeakMap<object, WeakSet<object>>()
  private clearTraceVias = new WeakMap<object, WeakSet<object>>()
  private clearTraceObstacles = new WeakMap<object, WeakSet<object>>()
  private clearViaObstacles = new WeakMap<object, WeakSet<object>>()
  private clearGeometryCount = 0

  private getGeometryIdentity(kind: string, traceId: string, pointIndex: number,
    aX: number, aY: number, bX: number, bY: number, size: number): object {
    let snapshots = this.previousTraceGeometry.get(traceId)
    const previous = snapshots?.[pointIndex]
    // Compare current scalar values even when callers reuse mutable route and
    // point objects. Unchanged segments avoid rebuilding numeric string keys.
    if (previous && previous.kind === kind && Object.is(previous.aX, aX) &&
      Object.is(previous.aY, aY) && Object.is(previous.bX, bX) &&
      Object.is(previous.bY, bY) && Object.is(previous.size, size))
      return previous.identity
    // String(number) preserves finite values and infinities. Negative zero has
    // its own key because a later closest-point calculation may retain its sign.
    let key = kind
    for (const coordinate of [aX, aY, bX, bY, size])
      key += `|${Object.is(coordinate, -0) ? "-0" : String(coordinate)}`
    let identity = this.geometryIdentities.get(key)
    if (!identity) {
      identity = {}
      if (this.geometryIdentities.size >= 65_536) {
        const oldest = this.geometryIdentities.keys().next().value!
        this.geometryIdentities.delete(oldest)
      }
      this.geometryIdentities.set(key, identity)
    }
    if (!previous && this.previousGeometryCount >= 65_536) {
      this.previousTraceGeometry.clear()
      this.previousGeometryCount = 0
      snapshots = undefined
    }
    if (!snapshots) {
      snapshots = []
      this.previousTraceGeometry.set(traceId, snapshots)
    }
    if (!snapshots[pointIndex]) this.previousGeometryCount++
    snapshots[pointIndex] = { kind, aX, aY, bX, bY, size, identity }
    return identity
  }

  private rememberClearGeometry(cache: WeakMap<object, WeakSet<object>>, left: object, right: object): void {
    if (this.clearGeometryCount >= 262_144) return
    let knownClear = cache.get(left)
    if (!knownClear) {
      knownClear = new WeakSet<object>()
      cache.set(left, knownClear)
    }
    knownClear.add(right)
    this.clearGeometryCount++
  }

  private readonly traceClearance: number
  private readonly viaClearance: number
  private readonly viaToPadClearance: number
  private readonly cellSize: number
  private readonly connMap?: ConnectivityMap
  private readonly includeTraceViaOwnerMetadata: boolean
  private readonly canonicalNetByAlias = new Map<string, string>()
  private readonly connMapNetByCanonicalNet = new Map<string, string>()
  private readonly obstacles: StaticObstacle[]
  private readonly obstacleIndexesByLayer = new Map<
    string,
    SpatialHash<StaticObstacle>
  >()
  private dynamicIndexSnapshot?: DynamicIndexSnapshot
  private dynamicIndexesByLayer?: Map<string, SpatialHash<DynamicCollidable>>
  private dynamicCellBounds = new Float64Array(0)

  lastRunStats: AutoroutingDrcEngineRunStats = {
    traceCount: 0,
    segmentCount: 0,
    viaCount: 0,
    obstacleCount: 0,
    broadPhaseCandidateCount: 0,
    exactCheckCount: 0,
  }

  constructor(
    private readonly srj: SimpleRouteJson,
    options: AutoroutingDrcEngineOptions = {},
  ) {
    this.traceClearance = options.traceClearance ?? DEFAULT_TRACE_CLEARANCE
    this.viaClearance = Math.max(
      options.viaClearance ?? MIN_VIA_CLEARANCE,
      MIN_VIA_CLEARANCE,
    )
    this.viaToPadClearance =
      options.viaToPadClearance ??
      this.srj.minViaEdgeToPadEdgeClearance ??
      DEFAULT_VIA_TO_PAD_CLEARANCE
    this.connMap = options.connMap
    this.includeTraceViaOwnerMetadata =
      options.includeTraceViaOwnerMetadata ?? false
    this.cellSize = options.spatialCellSize ?? this.getDefaultSpatialCellSize()

    if (!Number.isFinite(this.traceClearance) || this.traceClearance < 0) {
      throw new Error("traceClearance must be a non-negative finite number")
    }
    if (!Number.isFinite(this.viaClearance)) {
      throw new Error("viaClearance must be a finite number")
    }
    if (
      !Number.isFinite(this.viaToPadClearance) ||
      this.viaToPadClearance < 0
    ) {
      throw new Error("viaToPadClearance must be a non-negative finite number")
    }
    if (!Number.isFinite(this.cellSize) || this.cellSize <= 0) {
      throw new Error("spatialCellSize must be a positive finite number")
    }

    this.compileConnectionAliases()
    this.obstacles = this.compileStaticObstacles()
    this.indexStaticObstacles()
  }

  private getDefaultSpatialCellSize() {
    const boardWidth = Math.max(0, this.srj.bounds.maxX - this.srj.bounds.minX)
    const boardHeight = Math.max(0, this.srj.bounds.maxY - this.srj.bounds.minY)
    return Math.max(
      0.25,
      Math.max(boardWidth, boardHeight) / 64,
      (this.srj.minViaDiameter ?? 0.3) +
        Math.max(this.traceClearance, this.viaToPadClearance),
    )
  }

  private compileConnectionAliases() {
    const connMapNetsByCanonicalNet = new Map<string, Set<string>>()

    for (const connection of this.srj.connections) {
      const canonicalNet =
        connection.netConnectionName ??
        connection.rootConnectionName ??
        connection.name
      const aliases = [
        connection.name,
        connection.rootConnectionName,
        connection.netConnectionName,
        ...(connection.mergedConnectionNames ?? []),
        ...connection.pointsToConnect.flatMap((point) => [
          point.pointId,
          point.pcb_port_id,
        ]),
      ]

      for (const alias of aliases) {
        if (!alias) continue
        this.canonicalNetByAlias.set(alias, canonicalNet)

        const connMapNetId = this.connMap?.getNetConnectedToId(alias)
        if (!connMapNetId) continue
        let connMapNets = connMapNetsByCanonicalNet.get(canonicalNet)
        if (!connMapNets) {
          connMapNets = new Set<string>()
          connMapNetsByCanonicalNet.set(canonicalNet, connMapNets)
        }
        connMapNets.add(connMapNetId)
      }
      this.canonicalNetByAlias.set(canonicalNet, canonicalNet)
    }

    // A sparse connectivity map may recognize only one alias in an SRJ net.
    // Promote only unambiguous map nets across the rest of that alias group.
    for (const [canonicalNet, connMapNets] of connMapNetsByCanonicalNet) {
      if (connMapNets.size !== 1) continue
      this.connMapNetByCanonicalNet.set(
        canonicalNet,
        connMapNets.values().next().value!,
      )
    }
  }

  private resolveNetId(id: string) {
    const connMapNetId = this.connMap?.getNetConnectedToId(id)
    if (connMapNetId) return connMapNetId
    const canonicalNet = this.canonicalNetByAlias.get(id)
    if (!canonicalNet) return id
    return this.connMapNetByCanonicalNet.get(canonicalNet) ?? canonicalNet
  }

  private areConnected(left: string, right: string) {
    if (left === right) return true
    if (this.connMap?.areIdsConnected(left, right)) return true
    return this.resolveNetId(left) === this.resolveNetId(right)
  }

  private compileStaticObstacles() {
    const obstacles: StaticObstacle[] = []
    const addedSmtPadIds = new Set<string>()
    const addedPlatedHoleIds = new Set<string>()

    for (const obstacle of this.srj.obstacles) {
      if (obstacle.layers.length === 0) continue
      const smtPadId = obstacle.connectedTo.find((id) =>
        id.startsWith("pcb_smtpad_"),
      )
      const platedHoleId = obstacle.connectedTo.find((id) =>
        id.startsWith("pcb_plated_hole_"),
      )
      const pcbPortId = obstacle.connectedTo.find((id) =>
        id.startsWith("pcb_port_"),
      )
      if (!smtPadId && !platedHoleId && !pcbPortId) continue

      const isMultiLayer = obstacle.layers.length > 1
      const obstacleType = isMultiLayer
        ? ("pcb_plated_hole" as const)
        : ("pcb_smtpad" as const)
      const obstacleId = isMultiLayer
        ? (platedHoleId ??
          `pcb_plated_hole_${obstacle.center.x.toFixed(
            3,
          )}_${obstacle.center.y.toFixed(3)}`)
        : (smtPadId ??
          `pcb_smtpad_${obstacle.center.x.toFixed(
            3,
          )}_${obstacle.center.y.toFixed(3)}`)
      const addedIds = isMultiLayer ? addedPlatedHoleIds : addedSmtPadIds
      if (addedIds.has(obstacleId)) continue
      addedIds.add(obstacleId)

      const hasRotation =
        typeof obstacle.ccwRotationDegrees === "number" &&
        Number.isFinite(obstacle.ccwRotationDegrees)
      const localToWorld = compose(
        translate(obstacle.center.x, obstacle.center.y),
        rotateDEG(hasRotation ? obstacle.ccwRotationDegrees! : 0),
      )
      // Explicit rotation describes a rectangular pad, including square pads.
      // Only legacy, unrotated multilayer obstacles use the circular inference.
      const isCircular =
        !hasRotation &&
        isMultiLayer &&
        Math.abs(obstacle.width - obstacle.height) < 0.001
      obstacles.push({
        kind: "obstacle",
        obstacleType,
        obstacleId,
        connectedTo: obstacle.connectedTo,
        x: obstacle.center.x,
        y: obstacle.center.y,
        width: obstacle.width,
        height: obstacle.height,
        localToWorld,
        worldToLocal: inverse(localToWorld),
        ...(isCircular
          ? { radius: Math.max(obstacle.width, obstacle.height) / 2 }
          : {}),
        layers: obstacle.layers,
        ...(pcbPortId ? { pcbPortId } : {}),
      })
    }

    return obstacles
  }

  private indexStaticObstacles() {
    for (const obstacle of this.obstacles) {
      const bounds = expandBounds(
        getObstacleBounds(obstacle),
        Math.max(this.traceClearance, this.viaToPadClearance),
      )
      for (const layer of obstacle.layers) {
        let index = this.obstacleIndexesByLayer.get(layer)
        if (!index) {
          index = new SpatialHash<StaticObstacle>(this.cellSize, true)
          this.obstacleIndexesByLayer.set(layer, index)
        }
        index.insert(obstacle, bounds)
      }
    }
  }

  private collectDynamicGeometry(traces: SimplifiedPcbTraces) {
    const segments: TraceSegment[] = []
    const vias: Via[] = []
    const viaLocations = new Set<string>()

    for (const trace of traces) {
      const netId = this.resolveNetId(trace.connection_name)
      const pcbPortIds = getTracePortIds(trace)

      for (let index = 0; index < trace.route.length - 1; index += 1) {
        const start = trace.route[index]
        const end = trace.route[index + 1]
        if (
          start?.route_type !== "wire" ||
          end?.route_type !== "wire" ||
          start.layer !== end.layer
        ) {
          continue
        }
        if (
          Math.abs(start.x - end.x) <= POSITION_EPSILON &&
          Math.abs(start.y - end.y) <= POSITION_EPSILON
        ) {
          continue
        }

        segments.push({
          kind: "trace_segment",
          order: segments.length,
          traceId: trace.pcb_trace_id,
          netId,
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          width: getWireWidth(start, end),
          layer: start.layer,
          pcbPortIds,
          geometryIdentity: this.getGeometryIdentity("segment", trace.pcb_trace_id, index, start.x, start.y, end.x, end.y, getWireWidth(start, end)),
        })
      }

      for (let routePointIndex = 0; routePointIndex < trace.route.length; routePointIndex++) {
        const routePoint = trace.route[routePointIndex]!
        if (routePoint.route_type !== "via") continue
        const locationKey = `${routePoint.x},${routePoint.y},${routePoint.from_layer},${routePoint.to_layer}`
        if (viaLocations.has(locationKey)) continue
        viaLocations.add(locationKey)

        vias.push({
          kind: "via",
          order: vias.length,
          viaId: `via_${vias.length}`,
          traceId: trace.pcb_trace_id,
          netId,
          x: routePoint.x,
          y: routePoint.y,
          diameter: routePoint.via_diameter ?? this.srj.minViaDiameter ?? 0.3,
          geometryIdentity: this.getGeometryIdentity("via", trace.pcb_trace_id, routePointIndex, routePoint.x, routePoint.y, routePoint.x, routePoint.y, routePoint.via_diameter ?? this.srj.minViaDiameter ?? 0.3),
          layers: getViaDrillLayers(
            routePoint,
            this.srj.layerCount,
            this.srj.allowBlindAndBuriedVias,
          ),
        })
      }
    }

    return { segments, vias }
  }

  private buildDynamicIndexes(
    segments: TraceSegment[],
    vias: Via[],
  ): Map<string, SpatialHash<DynamicCollidable>> {
    const cellBoundCount = (segments.length + vias.length) * 4
    if (this.dynamicCellBounds.length < cellBoundCount) {
      this.dynamicCellBounds = new Float64Array(cellBoundCount)
    }
    let reusable = this.dynamicIndexSnapshot !== undefined &&
      this.dynamicIndexesByLayer !== undefined &&
      this.dynamicIndexSnapshot.segmentCount === segments.length &&
      this.dynamicIndexSnapshot.viaCount === vias.length
    const snapshot = this.dynamicIndexSnapshot
    for (let row = 0; row < segments.length + vias.length; row++) {
      const segment = row < segments.length ? segments[row]! : undefined
      const via = segment ? undefined : vias[row - segments.length]!
      const bounds = expandBounds(
        segment ? getSegmentBounds(segment) : getViaBounds(via!),
        this.traceClearance,
      )
      const offset = row * 4
      this.dynamicCellBounds[offset] = Math.floor(bounds.minX / this.cellSize)
      this.dynamicCellBounds[offset + 1] = Math.floor(bounds.maxX / this.cellSize)
      this.dynamicCellBounds[offset + 2] = Math.floor(bounds.minY / this.cellSize)
      this.dynamicCellBounds[offset + 3] = Math.floor(bounds.maxY / this.cellSize)
      for (let coordinate = offset; coordinate < offset + 4; coordinate++) {
        const cell = this.dynamicCellBounds[coordinate]!
        if (!Number.isSafeInteger(cell) || !Object.is(cell, snapshot?.cellBounds[coordinate])) {
          reusable = false
        }
      }
      if (segment) {
        if (snapshot?.segmentLayers[row] !== segment.layer) reusable = false
      } else {
        const previousLayers = snapshot?.viaLayers[row - segments.length]
        if (!previousLayers || previousLayers.length !== via!.layers.length) {
          reusable = false
        } else {
          for (let layer = 0; layer < previousLayers.length; layer++) {
            if (previousLayers[layer] !== via!.layers[layer]) reusable = false
          }
        }
      }
    }
    if (reusable) {
      for (const index of this.dynamicIndexesByLayer!.values()) {
        index.replaceItems((item): DynamicCollidable => item.kind === "trace_segment"
          ? segments[item.order]!
          : vias[item.order]!)
      }
      return this.dynamicIndexesByLayer!
    }

    const indexes = new Map<string, SpatialHash<DynamicCollidable>>()
    const addToLayer = (
      layer: string,
      item: DynamicCollidable,
      offset: number,
    ): void => {
      let index = indexes.get(layer)
      if (!index) {
        index = new SpatialHash<DynamicCollidable>(this.cellSize)
        indexes.set(layer, index)
      }
      index.insertCellRange(item,
        this.dynamicCellBounds[offset]!, this.dynamicCellBounds[offset + 1]!,
        this.dynamicCellBounds[offset + 2]!, this.dynamicCellBounds[offset + 3]!)
    }

    for (const segment of segments) {
      addToLayer(segment.layer, segment, segment.order * 4)
    }
    for (const via of vias) {
      for (const layer of via.layers) {
        addToLayer(layer, via, (segments.length + via.order) * 4)
      }
    }

    this.dynamicIndexSnapshot = {
      segmentCount: segments.length,
      viaCount: vias.length,
      cellBounds: this.dynamicCellBounds.slice(0, cellBoundCount),
      segmentLayers: segments.map((segment): string => segment.layer),
      // Explicit via layer arrays may belong to mutable caller input.
      viaLayers: vias.map((via): string[] => via.layers.slice()),
    }
    this.dynamicIndexesByLayer = indexes
    return indexes
  }

  private obstacleSharesNet(netId: string, obstacle: StaticObstacle) {
    return obstacle.connectedTo.some((connectedId) =>
      this.areConnected(netId, connectedId),
    )
  }

  private checkTracePair(
    segmentA: TraceSegment,
    segmentB: TraceSegment,
  ): AutoroutingDrcError | undefined {
    if (this.areConnected(segmentA.netId, segmentB.netId)) return undefined
    this.lastRunStats.exactCheckCount += 1

    if (this.clearTracePairs.get(segmentA.geometryIdentity)?.has(segmentB.geometryIdentity)) return undefined

    const gap =
      segmentToSegmentMinDistance(
        segmentA.start,
        segmentA.end,
        segmentB.start,
        segmentB.end,
      ) -
      segmentA.width / 2 -
      segmentB.width / 2
    if (gap > this.traceClearance - DRC_EPSILON) {
      this.rememberClearGeometry(this.clearTracePairs, segmentA.geometryIdentity, segmentB.geometryIdentity)
      return undefined
    }

    const forwardId = `overlap_${segmentA.traceId}_${segmentB.traceId}`

    return {
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
      message: createTraceErrorMessage(
        segmentA.traceId,
        `PCB trace ${segmentB.traceId}`,
        gap,
      ),
      pcb_trace_id: segmentA.traceId,
      source_trace_id: "",
      pcb_trace_error_id: forwardId,
      minimum_clearance: this.traceClearance,
      actual_clearance: gap,
      pcb_component_ids: [],
      pcb_port_ids: [
        ...new Set([...segmentA.pcbPortIds, ...segmentB.pcbPortIds]),
      ],
      center: getClosestPointBetweenSegments(segmentA, segmentB),
    }
  }

  private checkTraceVia(
    segment: TraceSegment,
    via: Via,
  ): AutoroutingDrcError | undefined {
    if (this.areConnected(segment.netId, via.netId)) return undefined
    this.lastRunStats.exactCheckCount += 1

    if (this.clearTraceVias.get(segment.geometryIdentity)?.has(via.geometryIdentity)) return undefined

    const gap =
      segmentToCircleMinDistance(segment.start, segment.end, {
        x: via.x,
        y: via.y,
        radius: via.diameter / 2,
      }) -
      segment.width / 2
    if (gap > this.traceClearance - DRC_EPSILON) {
      this.rememberClearGeometry(this.clearTraceVias, segment.geometryIdentity, via.geometryIdentity)
      return undefined
    }

    const errorId = `overlap_${segment.traceId}_${via.viaId}`

    return {
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
      message: createTraceErrorMessage(
        segment.traceId,
        `pcb_via "${via.viaId}"`,
        gap,
      ),
      pcb_trace_id: segment.traceId,
      ...(this.includeTraceViaOwnerMetadata
        ? {
            pcb_trace_ids: [segment.traceId, via.traceId],
            pcb_via_id: via.viaId,
            pcb_via_ids: [via.viaId],
          }
        : {}),
      source_trace_id: "",
      pcb_trace_error_id: errorId,
      minimum_clearance: this.traceClearance,
      actual_clearance: gap,
      pcb_component_ids: [],
      pcb_port_ids: segment.pcbPortIds,
      center: getClosestPointBetweenSegmentAndPoint(segment, via),
    }
  }

  private checkTraceObstacle(
    segment: TraceSegment,
    obstacle: StaticObstacle,
  ): AutoroutingDrcError | undefined {
    if (this.obstacleSharesNet(segment.netId, obstacle)) return undefined
    this.lastRunStats.exactCheckCount += 1

    if (this.clearTraceObstacles.get(segment.geometryIdentity)?.has(obstacle)) return undefined

    const obstacleBounds = getObstacleLocalBounds(obstacle)
    const localSegment = {
      ...segment,
      start: applyToPoint(obstacle.worldToLocal, segment.start),
      end: applyToPoint(obstacle.worldToLocal, segment.end),
    }
    const shapeDistance =
      obstacle.radius === undefined
        ? segmentToBoundsMinDistance(
            localSegment.start,
            localSegment.end,
            obstacleBounds,
          )
        : segmentToCircleMinDistance(segment.start, segment.end, {
            x: obstacle.x,
            y: obstacle.y,
            radius: obstacle.radius,
          })
    const gap = shapeDistance - segment.width / 2
    if (gap + DRC_EPSILON >= this.traceClearance) {
      this.rememberClearGeometry(this.clearTraceObstacles, segment.geometryIdentity, obstacle)
      return undefined
    }

    const errorId = `overlap_${segment.traceId}_${obstacle.obstacleId}`

    return {
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
      message: createTraceErrorMessage(
        segment.traceId,
        `${obstacle.obstacleType} "${obstacle.obstacleId}"`,
        gap,
      ),
      pcb_trace_id: segment.traceId,
      source_trace_id: "",
      pcb_trace_error_id: errorId,
      minimum_clearance: this.traceClearance,
      actual_clearance: gap,
      pcb_component_ids: [],
      pcb_port_ids: [
        ...new Set([
          ...segment.pcbPortIds,
          ...(obstacle.pcbPortId ? [obstacle.pcbPortId] : []),
        ]),
      ],
      center:
        obstacle.radius === undefined
          ? applyToPoint(
              obstacle.localToWorld,
              getClosestPointBetweenSegmentAndBounds(
                localSegment,
                obstacleBounds,
              ),
            )
          : getClosestPointBetweenSegmentAndPoint(segment, obstacle),
    }
  }

  private checkViaObstacle(
    via: Via,
    obstacle: StaticObstacle,
  ): AutoroutingDrcError | undefined {
    if (this.obstacleSharesNet(via.netId, obstacle)) return undefined
    this.lastRunStats.exactCheckCount += 1

    if (this.clearViaObstacles.get(via.geometryIdentity)?.has(obstacle)) return undefined

    const obstacleBounds = getObstacleLocalBounds(obstacle)
    const localVia = applyToPoint(obstacle.worldToLocal, via)
    const pointToObstacleDistance =
      obstacle.radius === undefined
        ? Math.hypot(
            Math.max(
              obstacleBounds.minX - localVia.x,
              0,
              localVia.x - obstacleBounds.maxX,
            ),
            Math.max(
              obstacleBounds.minY - localVia.y,
              0,
              localVia.y - obstacleBounds.maxY,
            ),
          )
        : Math.hypot(via.x - obstacle.x, via.y - obstacle.y) - obstacle.radius
    const gap = pointToObstacleDistance - via.diameter / 2
    if (gap + DRC_EPSILON >= this.viaToPadClearance) {
      this.rememberClearGeometry(this.clearViaObstacles, via.geometryIdentity, obstacle)
      return undefined
    }

    const errorId = `via_pad_clearance_${via.viaId}_${obstacle.obstacleId}`
    const center = {
      x: (via.x + obstacle.x) / 2,
      y: (via.y + obstacle.y) / 2,
    }

    return {
      type: "pcb_pad_pad_clearance_error",
      error_type: "pcb_pad_pad_clearance_error",
      pcb_pad_pad_clearance_error_id: errorId,
      message: `pcb_via "${via.viaId}" and ${obstacle.obstacleType} "${obstacle.obstacleId}" are too close (gap: ${gap.toFixed(3)}mm)`,
      pcb_trace_id: via.traceId,
      pcb_pad_ids: [via.viaId, obstacle.obstacleId],
      pcb_via_ids: [via.viaId],
      minimum_clearance: this.viaToPadClearance,
      actual_clearance: gap,
      center,
    }
  }

  private checkViaPairs(vias: Via[]): AutoroutingDrcError[] {
    if (vias.length < 2) return []
    const errors: AutoroutingDrcError[] = []
    const index = new SpatialHash<Via>(this.cellSize)
    for (const via of vias) {
      index.insert(via, expandBounds(getViaBounds(via), this.viaClearance))
    }

    for (const viaA of vias) {
      for (const viaB of index.query(getViaBounds(viaA))) {
        this.lastRunStats.broadPhaseCandidateCount += 1
        if (viaB.order <= viaA.order) continue
        this.lastRunStats.exactCheckCount += 1

        const centerDistance = Math.hypot(viaA.x - viaB.x, viaA.y - viaB.y)
        if (centerDistance <= POSITION_EPSILON) continue
        const gap = centerDistance - viaA.diameter / 2 - viaB.diameter / 2
        if (gap + DRC_EPSILON >= this.viaClearance) continue

        const sameNet = this.areConnected(viaA.netId, viaB.netId)
        const pairId = [viaA.viaId, viaB.viaId].sort().join("_")
        const center = {
          x: (viaA.x + viaB.x) / 2,
          y: (viaA.y + viaB.y) / 2,
        }
        errors.push({
          type: "pcb_via_clearance_error",
          error_type: "pcb_via_clearance_error",
          pcb_error_id: `${
            sameNet ? "same_net" : "different_net"
          }_vias_close_${pairId}`,
          message: `Vias ${viaA.viaId} and ${viaB.viaId}${
            sameNet ? "" : " from different nets"
          } are too close together (gap: ${gap.toFixed(3)}mm)`,
          pcb_via_ids: [viaA.viaId, viaB.viaId],
          ...(this.includeTraceViaOwnerMetadata
            ? { pcb_trace_ids: [viaA.traceId, viaB.traceId] }
            : {}),
          pcb_via_pair_net_relation: sameNet ? "same_net" : "different_net",
          minimum_clearance: this.viaClearance,
          actual_clearance: gap,
          pcb_center: center,
          center,
        })
      }
    }

    return errors
  }

  evaluate(traces: SimplifiedPcbTraces): AutoroutingDrcResult {
    return this.evaluateInternal(traces, true)
  }

  /**
   * Evaluates the established trace/via DRC set used by the first repair
   * stage. Via-to-pad errors remain part of the normal complete evaluation and
   * are handled by the subsequent staged repair pass.
   */
  evaluateLegacy(traces: SimplifiedPcbTraces): AutoroutingDrcResult {
    return this.evaluateInternal(traces, false)
  }

  private evaluateInternal(
    traces: SimplifiedPcbTraces,
    includeViaPadErrors: boolean,
  ): AutoroutingDrcResult {
    if (this.clearGeometryCount >= 262_144) {
      this.clearTracePairs = new WeakMap<object, WeakSet<object>>()
      this.clearTraceVias = new WeakMap<object, WeakSet<object>>()
      this.clearTraceObstacles = new WeakMap<object, WeakSet<object>>()
      this.clearViaObstacles = new WeakMap<object, WeakSet<object>>()
      this.clearGeometryCount = 0
    }
    const { segments, vias } = this.collectDynamicGeometry(traces)
    const dynamicIndexesByLayer = this.buildDynamicIndexes(segments, vias)
    const detectedTraceErrors: AutoroutingDrcError[] = []
    const detectedViaPadErrors: AutoroutingDrcError[] = []

    this.lastRunStats = {
      traceCount: traces.length,
      segmentCount: segments.length,
      viaCount: vias.length,
      obstacleCount: this.obstacles.length,
      broadPhaseCandidateCount: 0,
      exactCheckCount: 0,
    }

    for (const segment of segments) {
      const queryBounds = getSegmentBounds(segment)
      const dynamicCandidates =
        dynamicIndexesByLayer.get(segment.layer)?.query(queryBounds) ?? []
      const obstacleCandidates =
        this.obstacleIndexesByLayer.get(segment.layer)?.query(queryBounds) ?? []

      for (const candidate of dynamicCandidates) {
        this.lastRunStats.broadPhaseCandidateCount += 1
        if (
          candidate.kind === "trace_segment" &&
          candidate.order <= segment.order
        ) {
          continue
        }

        const error =
          candidate.kind === "trace_segment"
            ? this.checkTracePair(segment, candidate)
            : this.checkTraceVia(segment, candidate)
        if (error) detectedTraceErrors.push(error)
      }

      for (const obstacle of obstacleCandidates) {
        this.lastRunStats.broadPhaseCandidateCount += 1
        const error = this.checkTraceObstacle(segment, obstacle)
        if (error) detectedTraceErrors.push(error)
      }
    }

    const detectedViaErrors = this.checkViaPairs(vias)

    if (includeViaPadErrors) {
      for (const via of vias) {
        const checkedObstacles = new Set<StaticObstacle>()
        for (const layer of via.layers) {
          const obstacleCandidates =
            this.obstacleIndexesByLayer.get(layer)?.query(getViaBounds(via)) ??
            []
          for (const obstacle of obstacleCandidates) {
            if (checkedObstacles.has(obstacle)) continue
            checkedObstacles.add(obstacle)
            this.lastRunStats.broadPhaseCandidateCount += 1
            const error = this.checkViaObstacle(via, obstacle)
            if (error) detectedViaPadErrors.push(error)
          }
        }
      }
    }

    const firstTraceErrorById = new Map<string, AutoroutingDrcError>()
    for (const error of detectedTraceErrors) {
      const errorId = String(error.pcb_trace_error_id)
      const existing = firstTraceErrorById.get(errorId)
      const actualClearance = Number(error.actual_clearance)
      if (!existing) {
        firstTraceErrorById.set(errorId, {
          ...error,
          first_contact_center: error.center,
          first_contact_message: error.message,
          first_actual_clearance: actualClearance,
          worst_contact_center: error.center,
          worst_contact_message: error.message,
          worst_actual_clearance: actualClearance,
        })
        continue
      }
      const worstActualClearance = Number(existing.worst_actual_clearance)
      if (
        actualClearance < worstActualClearance ||
        !Number.isFinite(worstActualClearance)
      ) {
        existing.worst_contact_center = error.center
        existing.worst_contact_message = error.message
        existing.worst_actual_clearance = actualClearance
      }
    }
    const errors: AutoroutingDrcError[] = [...firstTraceErrorById.values()].map(
      (error) => ({
        ...error,
        center:
          typeof error.worst_contact_center === "object"
            ? (error.worst_contact_center as Point)
            : error.center,
        message:
          typeof error.worst_contact_message === "string"
            ? error.worst_contact_message
            : error.message,
        actual_clearance:
          typeof error.worst_actual_clearance === "number"
            ? error.worst_actual_clearance
            : error.actual_clearance,
      }),
    )
    errors.push(...detectedViaPadErrors)
    errors.push(...detectedViaErrors)
    const errorsWithCenters = errors.filter((error) => error.center)
    const locationAwareErrors = errorsWithCenters as Array<
      AutoroutingDrcError & { center: Point }
    >

    return {
      errors,
      errorsWithCenters,
      locationAwareErrors,
    }
  }
}

const getWireWidth = (start: WireRoutePoint, end: WireRoutePoint): number =>
  start.width ?? end.width ?? 0.1

// Capture literal definition identities after module evaluation. Exact function
// text alone cannot establish a method's original lexical bindings.
const originalEnginePrototype = Pipeline9MemoizedAutoroutingDrcEngine.prototype
const originalEngineParent = spatialHashGetPrototype(originalEnginePrototype)
const originalEngineKeys = spatialHashOwnKeys(originalEnginePrototype)
const originalEngineDescriptors: PropertyDescriptor[] = []
for (let index = 0; index < originalEngineKeys.length; index++) {
  spatialHashDefineProperty(originalEngineDescriptors, index, { configurable: true, enumerable: true, writable: true,
    value: spatialHashGetDescriptor(originalEnginePrototype, originalEngineKeys[index]!)! })
}
const originalEngineConstructorParent = spatialHashGetPrototype(Pipeline9MemoizedAutoroutingDrcEngine)
const originalEngineConstructorKeys = spatialHashOwnKeys(Pipeline9MemoizedAutoroutingDrcEngine)
const originalEngineConstructorDescriptors: PropertyDescriptor[] = []
for (let index = 0; index < originalEngineConstructorKeys.length; index++) {
  spatialHashDefineProperty(originalEngineConstructorDescriptors, index, { configurable: true, enumerable: true, writable: true,
    value: spatialHashGetDescriptor(Pipeline9MemoizedAutoroutingDrcEngine, originalEngineConstructorKeys[index]!)! })
}
