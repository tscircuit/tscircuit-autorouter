import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import {
  SingleRouteCandidatePriorityQueue,
  type Node,
} from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "./SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

type Point = { x: number; y: number; z: number }
type Options = ConstructorParameters<typeof Native>[0] & {
  viaHoleDiameter?: number
  minViaHoleEdgeToViaHoleEdgeClearance?: number
  allowBlindAndBuriedVias?: boolean
  onWork?: (count: number) => void
}
type Wire = {
  start: Point
  end: Point
  z: number
  width: number
  connected: boolean
}
type Via = {
  center: { x: number; y: number }
  minZ: number
  maxZ: number
  diameter: number
  connected: boolean
}

/** A finite geometric graph: exhausted samples mean UNKNOWN, never infeasibility. */
export class SparsePhysicalSingleRouteSolver extends Native {
  readonly sparseDiagnostics = {
    vertices: 0,
    expansions: 0,
    edges: 0,
    geometryTests: 0,
    setupWork: 0,
  }
  private readonly sparseOptions: Options
  private readonly wires: Wire[] = []
  private readonly physicalVias: Via[] = []
  private readonly vertices: Point[] = []
  private readonly vertexKeys = new Map<string, number>()
  private readonly best = new Map<number, number>()
  private readonly sparseViaHoleDiameter: number
  private readonly holeGap: number

  constructor(options: Options) {
    super(options)
    this.sparseOptions = options
    this.sparseViaHoleDiameter = options.viaHoleDiameter ?? this.viaDiameter
    this.holeGap = options.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1
    // Native's constructor shortcut and raster queue are not search results for
    // this graph. All edges below go through the finite-width physical kernel.
    this.solved = false
    this.failed = false
    this.solvedPath = null
    this.error = null
    this.exploredNodes.clear()
    this.compileScene()
    this.constructVertices()
    const initial: Node = { ...this.A, g: 0, h: 0, f: 0, parent: null }
    this.candidates = new SingleRouteCandidatePriorityQueue([initial])
    this.best.set(this.vertexKeys.get(this.key(this.A))!, 0)
    this.sparseDiagnostics.vertices = this.vertices.length
    this.sparseDiagnostics.setupWork +=
      this.wires.length + this.physicalVias.length
    options.onWork?.(this.sparseDiagnostics.setupWork)
  }

  private key(point: Point): string {
    // Exact coordinates, rather than raster-rounded keys, identify vertices.
    // Every edge uses these immutable scene-local point records.
    const x = Object.is(point.x, -0) ? 0 : point.x
    const y = Object.is(point.y, -0) ? 0 : point.y
    return `${x},${y},${point.z}`
  }

  private compileScene(): void {
    for (const route of this.obstacleRoutes) {
      const currentNet = this.connMap?.getNetConnectedToId(this.connectionName)
      const obstacleNet = this.connMap?.getNetConnectedToId(
        route.connectionName,
      )
      const connected =
        route.connectionName === this.connectionName ||
        (currentNet !== undefined && currentNet === obstacleNet)
      const geometry = getPipeline9RouteCopperGeometry(route, {
        layerCount: this.layerCount,
        allowBlindAndBuriedVias: this.sparseOptions.allowBlindAndBuriedVias,
      })
      for (const wire of geometry.wireSegments)
        this.wires.push({ ...wire, connected })
      for (const via of geometry.viaSpans)
        this.physicalVias.push({ ...via, connected })
      for (const via of route.vias) {
        if (
          geometry.viaSpans.some(
            (span): boolean =>
              span.center.x === via.x && span.center.y === via.y,
          )
        )
          continue
        this.physicalVias.push({
          center: { ...via },
          minZ: 0,
          maxZ: this.layerCount - 1,
          diameter: route.viaDiameter,
          connected,
        })
      }
    }
  }

  private addVertex(point: Point): void {
    this.sparseDiagnostics.setupWork++
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !this.availableZ.includes(point.z)
    )
      return
    if (
      point.x < this.bounds.minX ||
      point.x > this.bounds.maxX ||
      point.y < this.bounds.minY ||
      point.y > this.bounds.maxY
    )
      return
    const key = this.key(point)
    if (this.vertexKeys.has(key)) return
    this.vertexKeys.set(key, this.vertices.length)
    this.vertices.push(point)
  }

  private constructVertices(): void {
    this.addVertex(this.A)
    this.addVertex(this.B)
    const xy: Array<{ x: number; y: number }> = [
      this.A,
      this.B,
      { x: (this.A.x + this.B.x) / 2, y: (this.A.y + this.B.y) / 2 },
    ]
    const inset =
      Math.max(this.viaDiameter / 2, this.traceThickness / 2) +
      this.obstacleMargin +
      1e-6
    for (const x of [this.bounds.minX + inset, this.bounds.maxX - inset]) {
      for (const y of [this.bounds.minY + inset, this.bounds.maxY - inset])
        xy.push({ x, y })
    }
    // Circumscribed octagons are outside the actual capsule/disc, so their
    // chords can clear its rounded boundary. Legality is still checked exactly.
    for (const wire of this.wires) {
      if (wire.connected) continue
      const radius =
        (wire.width + Math.max(this.traceThickness, this.viaDiameter)) / 2 +
        this.obstacleMargin +
        1e-6
      for (const center of [wire.start, wire.end]) {
        for (let i = 0; i < 8; i++) {
          const angle = (i * Math.PI) / 4
          xy.push({
            x: center.x + (Math.cos(angle) * radius) / Math.cos(Math.PI / 8),
            y: center.y + (Math.sin(angle) * radius) / Math.cos(Math.PI / 8),
          })
        }
      }
    }
    for (const via of this.physicalVias) {
      const radius =
        Math.max(
          (via.diameter + Math.max(this.traceThickness, this.viaDiameter)) / 2 +
            this.obstacleMargin,
          this.sparseViaHoleDiameter + this.holeGap,
        ) + 1e-6
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4
        xy.push({
          x: via.center.x + (Math.cos(angle) * radius) / Math.cos(Math.PI / 8),
          y: via.center.y + (Math.sin(angle) * radius) / Math.cos(Math.PI / 8),
        })
      }
    }
    for (const connection of this.futureConnections) {
      for (const point of connection.points) {
        xy.push(point)
        xy.push({ x: (point.x + this.A.x) / 2, y: (point.y + this.A.y) / 2 })
      }
    }
    for (const point of xy)
      for (const z of this.availableZ) this.addVertex({ ...point, z })
  }

  /** Full edge predicate; an empty endpoint is insufficient for a long edge. */
  isSparseEdgeLegal({
    start,
    end,
    parent,
  }: {
    start: Point
    end: Point
    parent?: Node | null
  }): boolean {
    const via = start.z !== end.z
    if (
      ![start, end].every(
        (p): boolean =>
          Number.isFinite(p.x) &&
          Number.isFinite(p.y) &&
          Number.isSafeInteger(p.z) &&
          p.z >= 0 &&
          p.z < this.layerCount,
      )
    )
      return false
    if (!this.availableZ.includes(start.z) || !this.availableZ.includes(end.z))
      return false
    if (via && (start.x !== end.x || start.y !== end.y)) return false
    const radius = via ? this.viaDiameter / 2 : this.traceThickness / 2
    const border = radius + this.obstacleMargin / 2
    for (const point of [start, end]) {
      if (
        point.x < this.bounds.minX ||
        point.x > this.bounds.maxX ||
        point.y < this.bounds.minY ||
        point.y > this.bounds.maxY
      )
        return false
      const terminal =
        !via &&
        (this.key(point) === this.key(this.A) ||
          this.key(point) === this.key(this.B))
      if (
        !terminal &&
        (point.x < this.bounds.minX + border ||
          point.x > this.bounds.maxX - border ||
          point.y < this.bounds.minY + border ||
          point.y > this.bounds.maxY - border)
      )
        return false
    }
    const minZ =
      via && !this.sparseOptions.allowBlindAndBuriedVias
        ? 0
        : Math.min(start.z, end.z)
    const maxZ =
      via && !this.sparseOptions.allowBlindAndBuriedVias
        ? this.layerCount - 1
        : Math.max(start.z, end.z)
    for (const wire of this.wires) {
      this.sparseDiagnostics.geometryTests++
      this.sparseOptions.onWork?.(1)
      if (wire.connected || wire.z < minZ || wire.z > maxZ) continue
      if (
        minimumDistanceBetweenSegments(start, end, wire.start, wire.end) <
        radius + wire.width / 2 + this.obstacleMargin
      )
        return false
    }
    for (const obstacle of this.physicalVias) {
      this.sparseDiagnostics.geometryTests++
      this.sparseOptions.onWork?.(1)
      const d = pointToSegmentDistance(obstacle.center, start, end)
      // All ancestors were routed with this DAG's immutable board hole diameter;
      // exact XY, pad diameter and span are required to reuse that same drill.
      // Same-net copper is reusable; distinct drilling remains owner-independent.
      if (
        via &&
        d < this.sparseViaHoleDiameter + this.holeGap &&
        !(
          obstacle.connected &&
          start.x === obstacle.center.x &&
          start.y === obstacle.center.y &&
          obstacle.diameter === this.viaDiameter &&
          obstacle.minZ === minZ &&
          obstacle.maxZ === maxZ
        )
      )
        return false
      if (
        !obstacle.connected &&
        obstacle.minZ <= maxZ &&
        obstacle.maxZ >= minZ &&
        d < radius + obstacle.diameter / 2 + this.obstacleMargin
      )
        return false
    }
    if (via) {
      let cursor = parent
      while (cursor?.parent) {
        this.sparseDiagnostics.geometryTests++
        this.sparseOptions.onWork?.(1)
        if (cursor.z !== cursor.parent.z) {
          const d = Math.hypot(start.x - cursor.x, start.y - cursor.y)
          const previousMinZ = this.sparseOptions.allowBlindAndBuriedVias
            ? Math.min(cursor.z, cursor.parent.z)
            : 0
          const previousMaxZ = this.sparseOptions.allowBlindAndBuriedVias
            ? Math.max(cursor.z, cursor.parent.z)
            : this.layerCount - 1
          if (
            d < this.sparseViaHoleDiameter + this.holeGap &&
            !(
              start.x === cursor.x &&
              start.y === cursor.y &&
              previousMinZ === minZ &&
              previousMaxZ === maxZ
            )
          )
            return false
        }
        cursor = cursor.parent
      }
      // Retain the native terminal/future connection reservation policy too.
      const node: Node = { ...end, g: 0, h: 0, f: 0, parent: parent ?? null }
      if (this.isViaTooCloseToFutureConnectionTrace(node)) return false
    }
    return true
  }

  override _step(): void {
    let current = this.candidates.dequeue()
    while (current) {
      const id = this.vertexKeys.get(this.key(current))!
      if (
        !this.exploredNodes.has(id) &&
        current.g <= (this.best.get(id) ?? Infinity)
      )
        break
      current = this.candidates.dequeue()
    }
    if (!current) {
      this.failed = true
      this.error =
        "Sparse physical candidate UNKNOWN: finite visibility graph exhausted"
      return
    }
    const id = this.vertexKeys.get(this.key(current))!
    this.exploredNodes.add(id)
    this.sparseDiagnostics.expansions++
    if (this.key(current) === this.key(this.B)) {
      this.setSolvedPath(current)
      this.solved = true
      return
    }
    for (let nextId = 0; nextId < this.vertices.length; nextId++) {
      const next = this.vertices[nextId]
      this.sparseOptions.onWork?.(1)
      if (this.exploredNodes.has(nextId)) continue
      if (
        next.z !== current.z &&
        (next.x !== current.x || next.y !== current.y)
      )
        continue
      const via = next.z !== current.z
      const g =
        current.g +
        Math.hypot(next.x - current.x, next.y - current.y) +
        (via ? this.viaPenaltyDistance : 0)
      if (g >= (this.best.get(nextId) ?? Infinity)) continue
      this.sparseDiagnostics.edges++
      if (
        !this.isSparseEdgeLegal({ start: current, end: next, parent: current })
      )
        continue
      const h =
        Math.hypot(next.x - this.B.x, next.y - this.B.y) +
        (next.z === this.B.z ? 0 : this.viaPenaltyDistance)
      this.best.set(nextId, g)
      this.candidates.enqueue({ ...next, g, h, f: g + h, parent: current })
    }
  }
}
