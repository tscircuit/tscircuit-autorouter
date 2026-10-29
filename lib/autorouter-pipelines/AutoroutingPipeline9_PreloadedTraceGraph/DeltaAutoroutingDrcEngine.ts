/*
MIT License

Copyright (c) 2026 tscircuit Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Pinned predicate source: high-density-repair03 550e7644ef2c4dfda12559fdd4445e15ec0c2709.
This experimental copy preserves its predicates and ordered error aggregation.
Only dynamic geometry construction, indexing, and affected-query scheduling differ.
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
  locationKey?: string
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

  constructor(private readonly cellSize: number) {}

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

  query(bounds: Bounds): T[] {
    const minCellX = Math.floor(bounds.minX / this.cellSize)
    const maxCellX = Math.floor(bounds.maxX / this.cellSize)
    const minCellY = Math.floor(bounds.minY / this.cellSize)
    const maxCellY = Math.floor(bounds.maxY / this.cellSize)
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

    return results
  }
}


type CachedTraceGeometry = {
  signature: string
  revision: number
  segments: TraceSegment[]
  vias: Via[]
}

/** Mutable index with deletion; each cell retains the pinned insertion ordering at query time. */
type DeltaIndexCell<T> = { items: Set<T>; ordered?: T[] }

class DeltaSpatialIndex<T> {
  private readonly cells = new Map<number, Map<number, DeltaIndexCell<T>>>()
  private readonly membership = new Map<T, Array<{ x: number; y: number; cell: DeltaIndexCell<T> }>>()

  constructor(
    private readonly size: number,
    private readonly compare: (a: T, b: T) => number,
  ) {}

  private range(bounds: Bounds): Bounds {
    const range = {
      minX: Math.floor(bounds.minX / this.size), maxX: Math.floor(bounds.maxX / this.size),
      minY: Math.floor(bounds.minY / this.size), maxY: Math.floor(bounds.maxY / this.size),
    }
    if (!Object.values(range).every(Number.isSafeInteger)) {
      throw new Error("Delta DRC requires finite, safely indexable copper bounds")
    }
    return range
  }

  insert(item: T, bounds: Bounds): void {
    if (this.membership.has(item)) throw new Error("Delta DRC indexed a primitive twice")
    const range = this.range(bounds)
    const membership: Array<{ x: number; y: number; cell: DeltaIndexCell<T> }> = []
    for (let x = range.minX; x <= range.maxX; x++) {
      let column = this.cells.get(x)
      if (!column) this.cells.set(x, column = new Map())
      for (let y = range.minY; y <= range.maxY; y++) {
        let cell = column.get(y)
        if (!cell) column.set(y, cell = { items: new Set<T>() })
        cell.items.add(item)
        cell.ordered = undefined
        membership.push({ x, y, cell })
      }
    }
    this.membership.set(item, membership)
  }

  remove(item: T): void {
    const membership = this.membership.get(item)
    if (!membership) throw new Error("Delta DRC removed an unknown primitive")
    for (const { x, y, cell } of membership) {
      cell.items.delete(item)
      cell.ordered = undefined
      if (!cell.items.size) {
        const column = this.cells.get(x)!
        column.delete(y)
        if (!column.size) this.cells.delete(x)
      }
    }
    this.membership.delete(item)
  }

  invalidateOrdering(): void {
    for (const column of this.cells.values()) {
      for (const cell of column.values()) {
        cell.ordered = undefined
      }
    }
  }

  query(bounds: Bounds): T[] {
    const range = this.range(bounds)
    const seen = new Set<T>()
    const result: T[] = []
    // Preserve x/y cell traversal, then original primitive insertion ordering.
    for (let x = range.minX; x <= range.maxX; x++) {
      const column = this.cells.get(x)
      if (!column) continue
      for (let y = range.minY; y <= range.maxY; y++) {
        const cell = column.get(y)
        if (!cell) continue
        cell.ordered ??= [...cell.items].sort(this.compare)
        for (const item of cell.ordered) {
          if (seen.has(item)) continue
          seen.add(item)
          result.push(item)
        }
      }
    }
    return result
  }
}

export type DeltaDrcStats = {
  deltaDrcCalls: number
  deltaDrcCompiledTraces: number
  deltaDrcReusedTraces: number
  deltaDrcInsertedPrimitives: number
  deltaDrcRemovedPrimitives: number
  deltaDrcTouchedQueries: number
  deltaDrcReusedQueries: number
  deltaDrcCurrentSegments: number
  deltaDrcCurrentVias: number
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
 * Pinned candidate-scoring predicates with persistent dynamic copper indexes.
 * Each evaluation applies a geometry delta and recomputes only affected queries;
 * original traversal order and full-board error aggregation remain authoritative.
 * This does not replace the independent reference/physical acceptance checks.
 */
export class DeltaAutoroutingDrcEngine {

  readonly deltaStats: DeltaDrcStats = {
    deltaDrcCalls: 0, deltaDrcCompiledTraces: 0, deltaDrcReusedTraces: 0,
    deltaDrcInsertedPrimitives: 0, deltaDrcRemovedPrimitives: 0,
    deltaDrcTouchedQueries: 0, deltaDrcReusedQueries: 0,
    deltaDrcCurrentSegments: 0, deltaDrcCurrentVias: 0,
  }
  private traceGeometry = new Map<string, CachedTraceGeometry>()
  private geometryRevision = 0
  private segmentByKey = new Map<string, TraceSegment>()
  private viaByKey = new Map<string, Via>()
  private dynamicIndexes = new Map<string, DeltaSpatialIndex<DynamicCollidable>>()
  private viaPairIndex?: DeltaSpatialIndex<Via>
  private readonly segmentLedger = new Map<TraceSegment, AutoroutingDrcError[]>()
  private readonly viaPairLedger = new Map<Via, AutoroutingDrcError[]>()
  private readonly viaPadLedger = new Map<Via, AutoroutingDrcError[]>()
  private deltaConnectivityKey?: string

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
          index = new SpatialHash<StaticObstacle>(this.cellSize)
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

        })
      }

      for (const routePoint of trace.route) {
        if (routePoint.route_type !== "via") continue
        const locationKey = `${routePoint.x},${routePoint.y},${routePoint.from_layer},${routePoint.to_layer}`
        if (viaLocations.has(locationKey)) continue
        viaLocations.add(locationKey)

        const viaId = `via_${vias.length}`
        const diameter =
          routePoint.via_diameter ?? this.srj.minViaDiameter ?? 0.3
        const layers = getViaDrillLayers({
          via: routePoint,
          layerCount: this.srj.layerCount,
          allowBlindAndBuriedVias: this.srj.allowBlindAndBuriedVias,
        })
        vias.push({
          kind: "via",
          locationKey,
          order: vias.length,
          viaId,
          traceId: trace.pcb_trace_id,
          netId,
          x: routePoint.x,
          y: routePoint.y,
          diameter,
          layers,
        })
      }
    }

    return { segments, vias }
  }

  private obstacleSharesNet(netId: string, obstacle: StaticObstacle) {
    return obstacle.connectedTo.some((connectedId) =>
      this.areConnected(netId, connectedId),
    )
  }

  private checkTraceQuery(
    segment: TraceSegment,
    dynamicCandidates: DynamicCollidable[],
    obstacleCandidates: StaticObstacle[],
  ): AutoroutingDrcError[] {
    this.lastRunStats.broadPhaseCandidateCount +=
      dynamicCandidates.length + obstacleCandidates.length
      const errors: AutoroutingDrcError[] = []
      for (const candidate of dynamicCandidates) {
        if (
          candidate.kind === "trace_segment" &&
          candidate.order <= segment.order
        )
          continue
        const error =
          candidate.kind === "trace_segment"
            ? this.checkTracePair(segment, candidate)
            : this.checkTraceVia(segment, candidate)
        if (error) errors.push(error)
      }
      for (const obstacle of obstacleCandidates) {
        const error = this.checkTraceObstacle(segment, obstacle)
        if (error) errors.push(error)
      }
      return errors
  }

  private checkTracePair(
    segmentA: TraceSegment,
    segmentB: TraceSegment,
  ): AutoroutingDrcError | undefined {
    if (this.areConnected(segmentA.netId, segmentB.netId)) return undefined
    this.lastRunStats.exactCheckCount += 1

    const gap =
      segmentToSegmentMinDistance(
        segmentA.start,
        segmentA.end,
        segmentB.start,
        segmentB.end,
      ) -
      segmentA.width / 2 -
      segmentB.width / 2
    if (gap > this.traceClearance - DRC_EPSILON) return undefined

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

    const gap =
      segmentToCircleMinDistance(segment.start, segment.end, {
        x: via.x,
        y: via.y,
        radius: via.diameter / 2,
      }) -
      segment.width / 2
    if (gap > this.traceClearance - DRC_EPSILON) return undefined

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
    if (gap + DRC_EPSILON >= this.traceClearance) return undefined

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
    if (gap + DRC_EPSILON >= this.viaToPadClearance) return undefined

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

  private checkViaPadQuery(via: Via): AutoroutingDrcError[] {
      const errors: AutoroutingDrcError[] = []
      const checkedObstacles = new Set<StaticObstacle>()
      for (const layer of via.layers) {
        const obstacleCandidates =
          this.obstacleIndexesByLayer.get(layer)?.query(getViaBounds(via)) ?? []
        for (const obstacle of obstacleCandidates) {
          if (checkedObstacles.has(obstacle)) continue
          checkedObstacles.add(obstacle)
          this.lastRunStats.broadPhaseCandidateCount += 1
          const error = this.checkViaObstacle(via, obstacle)
          if (error) errors.push(error)
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


  private evaluateDeltaViaPairs(viaA: Via): AutoroutingDrcError[] {
    const errors: AutoroutingDrcError[] = []
    for (const viaB of this.viaPairIndex!.query(getViaBounds(viaA))) {
      this.lastRunStats.broadPhaseCandidateCount++
      if (viaB.order <= viaA.order) continue
      this.lastRunStats.exactCheckCount++
      const distance = Math.hypot(viaA.x - viaB.x, viaA.y - viaB.y)
      if (distance <= POSITION_EPSILON) continue
      const gap = distance - viaA.diameter / 2 - viaB.diameter / 2
      if (gap + DRC_EPSILON >= this.viaClearance) continue
      const sameNet = this.areConnected(viaA.netId, viaB.netId)
      const pairId = [viaA.viaId, viaB.viaId].sort().join("_")
      const center = { x: (viaA.x + viaB.x) / 2, y: (viaA.y + viaB.y) / 2 }
      errors.push({
        type: "pcb_via_clearance_error", error_type: "pcb_via_clearance_error",
        pcb_error_id: `${sameNet ? "same_net" : "different_net"}_vias_close_${pairId}`,
        message: `Vias ${viaA.viaId} and ${viaB.viaId}${sameNet ? "" : " from different nets"} are too close together (gap: ${gap.toFixed(3)}mm)`,
        pcb_via_ids: [viaA.viaId, viaB.viaId],
        ...(this.includeTraceViaOwnerMetadata ? { pcb_trace_ids: [viaA.traceId, viaB.traceId] } : {}),
        pcb_via_pair_net_relation: sameNet ? "same_net" : "different_net",
        minimum_clearance: this.viaClearance, actual_clearance: gap, pcb_center: center, center,
      })
    }
    return errors
  }

  private updateDeltaGeometry(traces: SimplifiedPcbTraces): {
    segments: TraceSegment[]; vias: Via[]; touchedSegments: Set<TraceSegment>;
    touchedVias: Set<Via>; insertedVias: Via[];
  } {
    this.deltaStats.deltaDrcCalls++
    const connectivityKey = JSON.stringify([
      this.connMap?.idToNetMap, this.obstacles.map((obstacle) => obstacle.connectedTo),
      this.srj.minViaDiameter, this.srj.layerCount, this.srj.allowBlindAndBuriedVias,
    ])
    const connectivityChanged = connectivityKey !== this.deltaConnectivityKey
    this.deltaConnectivityKey = connectivityKey
    const nextGeometry = new Map<string, CachedTraceGeometry>()
    const nextSegments = new Map<string, TraceSegment>()
    const nextVias = new Map<string, Via>()
    const traceOccurrences = new Map<string, number>()
    const viaLocations = new Set<string>()
    let previousSegmentRank = -1
    let segmentOrderingChanged = false
    for (const trace of traces) {
      const occurrence = traceOccurrences.get(trace.pcb_trace_id) ?? 0
      traceOccurrences.set(trace.pcb_trace_id, occurrence + 1)
      const traceKey = JSON.stringify([trace.pcb_trace_id, occurrence])
      const signature = JSON.stringify(trace, (_key, value: unknown) =>
        typeof value === "number" && Object.is(value, -0) ? { deltaNumber: "negative-zero" } : value)
      let geometry = this.traceGeometry.get(traceKey)
      if (!geometry || geometry.signature !== signature || connectivityChanged) {
        geometry = { signature, revision: this.geometryRevision++, ...this.collectDynamicGeometry([trace]) }
        this.deltaStats.deltaDrcCompiledTraces++
      } else this.deltaStats.deltaDrcReusedTraces++
      nextGeometry.set(traceKey, geometry)
      for (const [index, compiled] of geometry.segments.entries()) {
        const order = nextSegments.size
        const key = `${geometry.revision}:s${index}`
        const existing = this.segmentByKey.get(key)
        if (existing) {
          if (existing.order < previousSegmentRank) segmentOrderingChanged = true
          previousSegmentRank = existing.order
        }
        nextSegments.set(key, existing ?? { ...compiled, order })
      }
      for (const [index, compiled] of geometry.vias.entries()) {
        if (compiled.locationKey === undefined) throw new Error("Delta DRC via lost its physical identity")
        if (viaLocations.has(compiled.locationKey)) continue
        viaLocations.add(compiled.locationKey)
        const order = nextVias.size
        const key = `${geometry.revision}:v${index}:${order}`
        nextVias.set(key, this.viaByKey.get(key) ?? { ...compiled, order, viaId: `via_${order}` })
      }
    }
    const previousSegments = new Set(this.segmentByKey.values())
    const previousVias = new Set(this.viaByKey.values())
    const segmentSet = new Set(nextSegments.values())
    const viaSet = new Set(nextVias.values())
    const removedSegments = [...previousSegments].filter((item) => !segmentSet.has(item))
    const removedVias = [...previousVias].filter((item) => !viaSet.has(item))
    const insertedSegments = [...segmentSet].filter((item) => !previousSegments.has(item))
    const insertedVias = [...viaSet].filter((item) => !previousVias.has(item))
    const touchedSegments = new Set(segmentOrderingChanged ? segmentSet : insertedSegments)
    const touchedVias = new Set(insertedVias)
    // Adding bends shifts numeric ranks without changing the relative order of
    // existing primitives. Keep those identities and index rows in place.
    let segmentOrder = 0
    for (const segment of segmentSet) segment.order = segmentOrder++
    if (segmentOrderingChanged) {
      for (const index of this.dynamicIndexes.values()) index.invalidateOrdering()
    }
    this.viaPairIndex ??= new DeltaSpatialIndex<Via>(this.cellSize, (a, b) => a.order - b.order)
    const changed: DynamicCollidable[] = [...removedSegments, ...removedVias, ...insertedSegments, ...insertedVias]
    const touchNeighbors = (): void => {
      for (const item of changed) {
        const bounds = expandBounds(item.kind === "via" ? getViaBounds(item) : getSegmentBounds(item), this.traceClearance)
        const layers = item.kind === "via" ? item.layers : [item.layer]
        for (const layer of layers) {
          for (const neighbor of this.dynamicIndexes.get(layer)?.query(bounds) ?? []) {
            if (neighbor.kind === "trace_segment" && segmentSet.has(neighbor)) touchedSegments.add(neighbor)
          }
        }
        if (item.kind === "via") {
          for (const neighbor of this.viaPairIndex!.query(expandBounds(getViaBounds(item), this.viaClearance))) {
            if (viaSet.has(neighbor)) touchedVias.add(neighbor)
          }
        }
      }
    }
    touchNeighbors()
    for (const item of [...removedSegments, ...removedVias]) {
      const layers = item.kind === "via" ? item.layers : [item.layer]
      for (const layer of layers) this.dynamicIndexes.get(layer)!.remove(item)
      if (item.kind === "via") {
        this.viaPairIndex.remove(item)
        this.viaPairLedger.delete(item)
        this.viaPadLedger.delete(item)
      } else this.segmentLedger.delete(item)
    }
    for (const item of [...insertedSegments, ...insertedVias]) {
      const layers = item.kind === "via" ? item.layers : [item.layer]
      const bounds = item.kind === "via" ? getViaBounds(item) : getSegmentBounds(item)
      for (const layer of layers) {
        let index = this.dynamicIndexes.get(layer)
        if (!index) {
          index = new DeltaSpatialIndex<DynamicCollidable>(this.cellSize, (a, b) =>
            a.kind === b.kind ? a.order - b.order : a.kind === "trace_segment" ? -1 : 1)
          this.dynamicIndexes.set(layer, index)
        }
        index.insert(item, expandBounds(bounds, this.traceClearance))
      }
      if (item.kind === "via") this.viaPairIndex.insert(item, expandBounds(bounds, this.viaClearance))
    }
    touchNeighbors()
    this.traceGeometry = nextGeometry
    this.segmentByKey = nextSegments
    this.viaByKey = nextVias
    this.deltaStats.deltaDrcInsertedPrimitives += insertedSegments.length + insertedVias.length
    this.deltaStats.deltaDrcRemovedPrimitives += removedSegments.length + removedVias.length
    this.deltaStats.deltaDrcTouchedQueries += touchedSegments.size + touchedVias.size + insertedVias.length
    this.deltaStats.deltaDrcReusedQueries += segmentSet.size - touchedSegments.size + viaSet.size - touchedVias.size + viaSet.size - insertedVias.length
    this.deltaStats.deltaDrcCurrentSegments = segmentSet.size
    this.deltaStats.deltaDrcCurrentVias = viaSet.size
    return { segments: [...segmentSet], vias: [...viaSet], touchedSegments, touchedVias, insertedVias }
  }

  private evaluateInternal(
    traces: SimplifiedPcbTraces,
    includeViaPadErrors: boolean,
  ): AutoroutingDrcResult {
    const { segments, vias, touchedSegments, touchedVias, insertedVias } = this.updateDeltaGeometry(traces)
    this.lastRunStats = {
      traceCount: traces.length, segmentCount: segments.length, viaCount: vias.length,
      obstacleCount: this.obstacles.length, broadPhaseCandidateCount: 0, exactCheckCount: 0,
    }
    for (const segment of touchedSegments) {
      const bounds = getSegmentBounds(segment)
      const errors = this.checkTraceQuery(
        segment,
        this.dynamicIndexes.get(segment.layer)?.query(bounds) ?? [],
        this.obstacleIndexesByLayer.get(segment.layer)?.query(bounds) ?? [],
      )
      if (errors.length) this.segmentLedger.set(segment, errors)
      else this.segmentLedger.delete(segment)
    }
    for (const via of touchedVias) {
      const errors = this.evaluateDeltaViaPairs(via)
      if (errors.length) this.viaPairLedger.set(via, errors)
      else this.viaPairLedger.delete(via)
    }
    // Static pad results depend only on the selected via owner/geometry/connectivity.
    for (const via of insertedVias) {
      const errors = this.checkViaPadQuery(via)
      if (errors.length) this.viaPadLedger.set(via, errors)
      else this.viaPadLedger.delete(via)
    }
    // Empty queries need no stored row: unchanged primitives retain their proved zero.
    const orderedErrors = <T extends { order: number }>(ledger: Map<T, AutoroutingDrcError[]>): AutoroutingDrcError[] =>
      [...ledger].sort(([a], [b]) => a.order - b.order).flatMap(([, errors]) => errors)
    const detectedTraceErrors = orderedErrors(this.segmentLedger)
    const detectedViaPadErrors = includeViaPadErrors ? orderedErrors(this.viaPadLedger) : []
    const detectedViaErrors = orderedErrors(this.viaPairLedger)

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

    // Consumers may decorate findings; retained ledger entries must stay private.
    return structuredClone({ errors, errorsWithCenters, locationAwareErrors })
  }
}

const getWireWidth = (start: WireRoutePoint, end: WireRoutePoint): number =>
  start.width ?? end.width ?? 0.1
