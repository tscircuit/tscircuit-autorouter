import Flatbush from "flatbush"
import type { GraphicsObject } from "graphics-debug"
import { SingleRouteCandidatePriorityQueue, type Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { getConnectionPointLayers } from "lib/utils/connection-point-utils"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { acceptKrtBranches } from "./acceptKrtBranches"
import { prepareKrtBranches, type KrtBranch } from "./prepareKrtBranches"

type Point = { x: number; y: number }
type Segment = { a: Point; b: Point }
type Blocker = {
  id: number
  layers: Set<string>
  owner: string | null
  obstacle?: Obstacle
  segment?: Segment
  radius: number
  drill?: boolean
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}
export interface GeometryAutoroutingPipelineSolverOptions {
  /** This engine has no cache; accept the shared benchmark's explicit cold-run option. */
  cacheProvider?: null
  effort?: number
  maxSearchNodes?: number
  maxGeometryQueries?: number
  viaCost?: number
}

const pointSegmentDistance = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

const segmentDistance = (a: Point, b: Point, c: Point, d: Point): number => {
  const cross = (p: Point, q: Point, r: Point): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  if (abC * abD < 0 && cdA * cdB < 0) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}

const obstacleDistance = (a: Point, b: Point, obstacle: Obstacle): number => {
  if (obstacle.shape === "circle") return pointSegmentDistance(obstacle.center, a, b) - Math.max(obstacle.width, obstacle.height) / 2
  const angle = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
  const transform = (p: Point): Point => ({ x: (p.x - obstacle.center.x) * Math.cos(angle) - (p.y - obstacle.center.y) * Math.sin(angle), y: (p.x - obstacle.center.x) * Math.sin(angle) + (p.y - obstacle.center.y) * Math.cos(angle) })
  const localA = transform(a)
  const localB = transform(b)
  const hw = obstacle.width / 2
  const hh = obstacle.height / 2
  if ([localA, localB].some((p) => Math.abs(p.x) <= hw && Math.abs(p.y) <= hh)) return 0
  const corners = [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }]
  return Math.min(...corners.map((p, i) => segmentDistance(localA, localB, p, corners[(i + 1) % corners.length])))
}

/** Whole-board search on obstacle events: no capacity cells, ports or fixed raster. */
export class GeometryAutoroutingPipelineSolver extends BaseSolver {
  readonly srj: SimpleRouteJson
  readonly opts: GeometryAutoroutingPipelineSolverOptions
  readonly layers: string[]
  readonly outline: Point[]
  readonly dimensions: ReturnType<typeof getViaDimensions>
  readonly connectivity: ReturnType<typeof getConnectivityMapFromSimpleRouteJson>
  readonly inputSrj: SimpleRouteJson
  traces: SimplifiedPcbTraces = []
  branches: KrtBranch[] = []
  blockers: Blocker[] = []
  index: Flatbush | null = null
  timeSpentOnPhase: Record<string, number> = {}
  startTimeOfPhase: Record<string, number> = {}
  endTimeOfPhase: Record<string, number> = {}
  pipelineDef = [{ solverName: "geometryVisibilitySolver" }]
  currentPipelineStepIndex = 0
  private prepared = false
  private branchBlockerOwners = new Set<string>()
  private branchOwnedBlockers = new Set<number>()
  private readonly triedOrders = new Set<string>()

  constructor(srj: SimpleRouteJson, opts: GeometryAutoroutingPipelineSolverOptions = {}) {
    super()
    this.inputSrj = srj
    this.srj = structuredClone(srj)
    this.opts = opts
    for (const [name, value] of Object.entries(opts)) {
      if (name === "cacheProvider") {
        if (value !== null && value !== undefined) throw new Error("Geometry cacheProvider must be null or undefined; this engine has no cache")
        continue
      }
      if (!["effort", "maxSearchNodes", "maxGeometryQueries", "viaCost"].includes(name)) throw new Error(`Geometry does not support option ${name}`)
      if (value !== undefined && (!Number.isFinite(value) || (name === "viaCost" ? value < 0 : value <= 0))) throw new Error(`Geometry ${name} must be finite and ${name === "viaCost" ? "nonnegative" : "positive"}`)
    }
    if (!Number.isInteger(srj.layerCount) || srj.layerCount < 1) throw new Error("Geometry layerCount must be a positive integer")
    this.layers = Array.from({ length: srj.layerCount }, (_, z) => mapZToLayerName(z, srj.layerCount))
    this.outline = srj.outline ?? [{ x: srj.bounds.minX, y: srj.bounds.minY }, { x: srj.bounds.maxX, y: srj.bounds.minY }, { x: srj.bounds.maxX, y: srj.bounds.maxY }, { x: srj.bounds.minX, y: srj.bounds.maxY }]
    this.dimensions = getViaDimensions(srj)
    this.connectivity = getConnectivityMapFromSimpleRouteJson(srj)
    this.MAX_ITERATIONS = Math.max(1000, 50 * srj.connections.reduce((n, c) => n + c.pointsToConnect.length, 0) + 5)
    this.stats = { backend: "lazy-obstacle-visibility-v1", geometryQueries: 0, searchExpansions: 0, obstacleEvents: 0, routedBranches: 0, throughVias: 0, reusedViaTransitions: 0, pipeline9StagesExecuted: 0, conflictReorders: 0, replayedBranches: 0, noRouteStates: 0 }
  }

  getConstructorParams(): readonly [SimpleRouteJson, GeometryAutoroutingPipelineSolverOptions] {
    return [this.inputSrj, this.opts]
  }

  getCurrentPhase(): string {
    return this.solved ? "none" : "geometryVisibilitySolver"
  }

  private addBlocker(blocker: Omit<Blocker, "id">): void {
    const bounds = blocker.bounds
    if (!Object.values(bounds).every(Number.isFinite)) {
      throw new Error("Geometry blocker has nonfinite coordinates")
    }
    if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
      throw new Error("Geometry blocker has inverted bounds")
    }
    this.blockers.push({ ...blocker, id: this.blockers.length })
  }

  private rebuildIndex(): void {
    if (this.blockers.length === 0) { this.index = null; return }
    this.index = new Flatbush(this.blockers.length)
    for (const b of this.blockers) this.index.add(b.bounds.minX, b.bounds.minY, b.bounds.maxX, b.bounds.maxY)
    this.index.finish()
  }

  private insideBoard(a: Point, b: Point, radius: number): boolean {
    const clearance = radius + (this.srj.minBoardEdgeClearance ?? 0)
    for (const point of [a, b]) {
      if (point.x < this.srj.bounds.minX + clearance - 1e-8 || point.x > this.srj.bounds.maxX - clearance + 1e-8 || point.y < this.srj.bounds.minY + clearance - 1e-8 || point.y > this.srj.bounds.maxY - clearance + 1e-8) return false
      let inside = false
      for (let i = 0, j = this.outline.length - 1; i < this.outline.length; j = i++) {
        const p = this.outline[i]
        const q = this.outline[j]
        if ((p.y > point.y) !== (q.y > point.y) && point.x < (q.x - p.x) * (point.y - p.y) / (q.y - p.y) + p.x) inside = !inside
      }
      if (!inside) return false
    }
    return this.outline.every((p, i) => segmentDistance(a, b, p, this.outline[(i + 1) % this.outline.length]) + 1e-8 >= clearance)
  }

  private firstBlocker(a: Point, b: Point, layer: string, radius: number, owner: string, via: boolean): Blocker | null {
    this.stats.geometryQueries++
    const margin = Math.max(this.srj.defaultObstacleMargin ?? 0.1, this.srj.minTraceToHoleEdgeClearance ?? 0)
    const extent = radius + margin
    const ids = this.index?.search(Math.min(a.x, b.x) - extent, Math.min(a.y, b.y) - extent, Math.max(a.x, b.x) + extent, Math.max(a.y, b.y) + extent) ?? []
    let nearest: Blocker | null = null
    let nearestDistance = Infinity
    for (const id of ids) {
      const blocker = this.blockers[id]
      if (!via && !blocker.layers.has(layer)) continue
      if (via && !this.layers.some((candidate) => blocker.layers.has(candidate))) continue
      const own = this.branchOwnedBlockers.has(blocker.id)
      if (own && (!via || (!blocker.obstacle && !blocker.drill))) continue
      if (own && blocker.drill && Math.hypot(a.x - blocker.segment!.a.x, a.y - blocker.segment!.a.y) < 1e-8) continue
      const physicalClearance = blocker.obstacle?.isNonPlatedHole ? (this.srj.minTraceToHoleEdgeClearance ?? this.srj.defaultObstacleMargin ?? 0.1) : own ? 0 : (this.srj.defaultObstacleMargin ?? 0.1)
      let required = radius + physicalClearance
      if (via && blocker.drill) {
        const drillDistance = this.dimensions.holeDiameter + Math.max(0.1, this.srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0) - blocker.radius
        required = own ? drillDistance : Math.max(required, drillDistance)
      }
      const distance = blocker.obstacle ? obstacleDistance(a, b, blocker.obstacle) : segmentDistance(a, b, blocker.segment!.a, blocker.segment!.b) - blocker.radius
      if (distance + 1e-8 >= required) continue
      const distanceFromStart = blocker.obstacle ? Math.hypot(a.x - blocker.obstacle.center.x, a.y - blocker.obstacle.center.y) : pointSegmentDistance(a, blocker.segment!.a, blocker.segment!.b)
      if (distanceFromStart < nearestDistance) { nearest = blocker; nearestDistance = distanceFromStart }
    }
    if (nearest?.owner) this.branchBlockerOwners.add(nearest.owner)
    return nearest
  }

  private eventPoints(blocker: Blocker, radius: number, owner: string, via = false): Point[] {
    const ownPad = via && blocker.obstacle && this.branchOwnedBlockers.has(blocker.id)
    const clearance = radius + (blocker.obstacle?.isNonPlatedHole ? (this.srj.minTraceToHoleEdgeClearance ?? this.srj.defaultObstacleMargin ?? 0.1) : ownPad ? 0 : (this.srj.defaultObstacleMargin ?? 0.1)) + 1e-5
    if (blocker.obstacle) {
      const obstacle = blocker.obstacle
      const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
      const hw = obstacle.width / 2 + clearance
      const hh = obstacle.height / 2 + clearance
      const local = [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }]
      if (via) local.push({ x: -hw, y: 0 }, { x: hw, y: 0 }, { x: 0, y: -hh }, { x: 0, y: hh })
      return local.map((p) => ({ x: obstacle.center.x + p.x * Math.cos(angle) - p.y * Math.sin(angle), y: obstacle.center.y + p.x * Math.sin(angle) + p.y * Math.cos(angle) }))
    }
    const segment = blocker.segment!
    const r = clearance + blocker.radius
    const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y)
    const dx = length === 0 ? 1 : (segment.b.x - segment.a.x) / length
    const dy = length === 0 ? 0 : (segment.b.y - segment.a.y) / length
    return [segment.a, segment.b].flatMap((p) => [-1, 1].flatMap((along) => [-1, 1].map((side) => ({ x: p.x + along * dx * r - side * dy * r, y: p.y + along * dy * r + side * dx * r }))))
  }

  private routeBranch(branch: KrtBranch): SimplifiedPcbTraces[number] | null {
    this.branchBlockerOwners.clear()
    const width = Math.max(this.srj.minTraceWidth, branch.connection.nominalTraceWidth ?? branch.connection.width ?? this.srj.nominalTraceWidth ?? this.srj.minTraceWidth)
    if (!Number.isFinite(width) || width <= 0) throw new Error(`Geometry requires a positive finite width for ${branch.connection.name}`)
    const radius = width / 2
    const owner = branch.connection.name
    this.branchOwnedBlockers = new Set(this.blockers.filter((blocker) => blocker.owner === owner || (blocker.owner !== null && this.connectivity.areIdsConnected(owner, blocker.owner)) || blocker.obstacle?.connectedTo.some((id) => this.connectivity.areIdsConnected(owner, id))).map((blocker) => blocker.id))
    const existingViaTargets = this.blockers.filter((blocker) => blocker.drill && this.branchOwnedBlockers.has(blocker.id)).map((blocker) => blocker.segment!.a)
    const [start, end] = branch.points
    const startLayers = getConnectionPointLayers(start)
    const endLayers = getConnectionPointLayers(end)
    if ([...startLayers, ...endLayers].some((layer) => !this.layers.includes(layer))) throw new Error(`Geometry terminal layer outside original board for ${owner}`)
    const viaRadius = this.dimensions.padDiameter / 2
    const viaCost = this.opts.viaCost ?? 1
    const budget = this.opts.maxSearchNodes ?? Math.round(20_000 * (this.opts.effort ?? 1))
    const queryBudget = this.opts.maxGeometryQueries ?? Math.round(300_000 * (this.opts.effort ?? 1))
    const queriesAtStart = this.stats.geometryQueries
    const key = (p: { x: number; y: number; z: number }): string => `${p.x.toFixed(7)},${p.y.toFixed(7)},${p.z}`
    const costs = new Map<string, number>()
    const queue = new SingleRouteCandidatePriorityQueue<Node>([])
    const enqueue = (point: Point, z: number, parent: Node | null, g: number): void => {
      const h = Math.hypot(end.x - point.x, end.y - point.y) + (endLayers.includes(this.layers[z]) ? 0 : viaCost)
      const node = { ...point, z, parent, g, h, f: g + h }
      if ((costs.get(key(node)) ?? Infinity) <= g + 1e-9) return
      costs.set(key(node), g)
      queue.enqueue(node)
    }
    for (const layer of startLayers) enqueue(start, this.layers.indexOf(layer), null, 0)
    let final: Node | null = null
    let expansions = 0
    while (queue.peek() && expansions < budget && this.stats.geometryQueries - queriesAtStart < queryBudget) {
      const node = queue.dequeue()!
      if (node.g > costs.get(key(node))! + 1e-9) continue
      expansions++
      if (Math.hypot(node.x - end.x, node.y - end.y) < 1e-8 && endLayers.includes(this.layers[node.z])) { final = node; break }
      const viaBlocker = this.firstBlocker(node, node, this.layers[node.z], viaRadius, owner, true)
      let pathDrillConflict = false
      for (let ancestor: Node | null = node; ancestor?.parent; ancestor = ancestor.parent) {
        if (ancestor.z === ancestor.parent.z) continue
        const distance = Math.hypot(node.x - ancestor.x, node.y - ancestor.y)
        if (distance > 1e-8 && distance + 1e-8 < this.dimensions.holeDiameter + Math.max(0.1, this.srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0)) pathDrillConflict = true
      }
      if (!viaBlocker && !pathDrillConflict && this.insideBoard(node, node, viaRadius)) {
        const reusedVia = existingViaTargets.some((point) => Math.hypot(point.x - node.x, point.y - node.y) < 1e-8)
        for (let z = 0; z < this.layers.length; z++) if (z !== node.z) enqueue(node, z, node, node.g + (reusedVia ? 0 : viaCost))
      }
      const targets: Point[] = [end, ...existingViaTargets]
      if (viaBlocker) targets.push(...this.eventPoints(viaBlocker, viaRadius, owner, true))
      // The target pad cannot host a via. Its inflated boundary supplies exact
      // escape events even when the current routing layer has no pad copper.
      for (const terminal of [start, end]) {
        const blocker = this.firstBlocker(terminal, terminal, this.layers[node.z], viaRadius, owner, true)
        if (blocker) targets.push(...this.eventPoints(blocker, viaRadius, owner, true))
      }
      const visitedBlockers = new Set<number>()
      const visitedTargets = new Set<string>()
      for (let i = 0; i < targets.length; i++) {
        if (this.stats.geometryQueries - queriesAtStart >= queryBudget) break
        const target = targets[i]
        const targetKey = `${target.x.toFixed(7)},${target.y.toFixed(7)}`
        if (visitedTargets.has(targetKey) || Math.hypot(node.x - target.x, node.y - target.y) < 1e-8) continue
        visitedTargets.add(targetKey)
        if (!this.insideBoard(node, target, radius)) continue
        const blocker = this.firstBlocker(node, target, this.layers[node.z], radius, owner, false)
        if (blocker) {
          if (!visitedBlockers.has(blocker.id)) {
            visitedBlockers.add(blocker.id)
            this.stats.obstacleEvents++
            targets.push(...this.eventPoints(blocker, radius, owner))
          }
        } else enqueue(target, node.z, node, node.g + Math.hypot(node.x - target.x, node.y - target.y))
      }
    }
    this.stats.searchExpansions += expansions
    if (!final) {
      this.stats.noRouteStates++
      this.stats.lastNoRouteWitness = { branch: branch.name, connection: owner, expansions, budget, geometryQueries: this.stats.geometryQueries - queriesAtStart, queryBudget, queryBudgetExhausted: this.stats.geometryQueries - queriesAtStart >= queryBudget, routedBlockerOwners: [...this.branchBlockerOwners] }
      return null
    }
    const path: Node[] = []
    for (let node: Node | null = final; node; node = node.parent) path.unshift(node)
    const route: SimplifiedPcbTraces[number]["route"] = []
    for (const [i, node] of path.entries()) {
      const previous = path[i - 1]
      if (previous && previous.z !== node.z) {
        route.push({ route_type: "via", x: node.x, y: node.y, from_layer: this.layers[previous.z], to_layer: this.layers[node.z], via_diameter: this.dimensions.padDiameter, via_hole_diameter: this.dimensions.holeDiameter })
        this.stats.throughVias++
        if (existingViaTargets.some((point) => Math.hypot(point.x - node.x, point.y - node.y) < 1e-8)) this.stats.reusedViaTransitions++
      }
      route.push({ route_type: "wire", x: node.x, y: node.y, layer: this.layers[node.z], width })
    }
    return { type: "pcb_trace", pcb_trace_id: branch.name, connection_name: branch.name, route }
  }

  private commitTrace(trace: SimplifiedPcbTraces[number], owner: string): void {
    for (const [i, point] of trace.route.entries()) {
      const previous = trace.route[i - 1]
      if (point.route_type === "via") {
        const center = { x: point.x, y: point.y }
        const r = this.dimensions.padDiameter / 2
        this.addBlocker({ owner, drill: true, layers: new Set(this.layers), segment: { a: center, b: center }, radius: r, bounds: { minX: point.x - r, maxX: point.x + r, minY: point.y - r, maxY: point.y + r } })
      } else if (point.route_type === "wire" && previous?.route_type === "wire" && previous.layer === point.layer) {
        const r = Math.max(point.width, previous.width) / 2
        this.addBlocker({ owner, layers: new Set([point.layer]), segment: { a: previous, b: point }, radius: r, bounds: { minX: Math.min(previous.x, point.x) - r, maxX: Math.max(previous.x, point.x) + r, minY: Math.min(previous.y, point.y) - r, maxY: Math.max(previous.y, point.y) + r } })
      }
    }
    this.rebuildIndex()
  }

  _step(): void {
    const phaseStart = performance.now()
    this.startTimeOfPhase.geometryVisibilitySolver ??= phaseStart
    try {
    if (!this.prepared) {
      this.branches = prepareKrtBranches(this.srj).branches
      for (const obstacle of this.srj.obstacles) {
        const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
        const hw = (Math.abs(obstacle.width * Math.cos(angle)) + Math.abs(obstacle.height * Math.sin(angle))) / 2
        const hh = (Math.abs(obstacle.width * Math.sin(angle)) + Math.abs(obstacle.height * Math.cos(angle))) / 2
        this.addBlocker({ obstacle, owner: null, layers: new Set(obstacle.layers), radius: 0, bounds: { minX: obstacle.center.x - hw, maxX: obstacle.center.x + hw, minY: obstacle.center.y - hh, maxY: obstacle.center.y + hh } })
      }
      this.rebuildIndex()
      this.prepared = true
      this.stats.branchCount = this.branches.length
    } else if (this.traces.length < this.branches.length) {
      const branch = this.branches[this.traces.length]
      const trace = this.routeBranch(branch)
      if (!trace) {
        // A no-route result is an explicit state of this bounded global search.
        // Reconsider the committed owners that blocked it, then replay their
        // suffix transactionally. Invariant/acceptance errors still throw.
        const maxReorders = Math.round(32 * (this.opts.effort ?? 1))
        let reordered = false
        for (let pivot = this.traces.length - 1; pivot >= 0; pivot--) {
          if (!this.branchBlockerOwners.has(this.branches[pivot].connection.name)) continue
          const candidate = [...this.branches]
          candidate.splice(this.traces.length, 1)
          candidate.splice(pivot, 0, branch)
          const orderKey = candidate.map((entry) => entry.name).join(",")
          if (this.triedOrders.has(orderKey) || this.stats.conflictReorders >= maxReorders) continue
          this.triedOrders.add(orderKey)
          this.stats.conflictReorders++
          this.stats.replayedBranches += this.traces.length - pivot
          this.branches = candidate
          this.traces.length = pivot
          this.blockers = this.blockers.filter((blocker) => blocker.obstacle)
          for (let i = 0; i < this.blockers.length; i++) this.blockers[i].id = i
          for (let i = 0; i < this.traces.length; i++) this.commitTrace(this.traces[i], this.branches[i].connection.name)
          this.rebuildIndex()
          reordered = true
          break
        }
        if (!reordered) throw new Error(`Geometry visibility global search exhausted for ${branch.connection.name} (${branch.name}): ${JSON.stringify(this.stats.lastNoRouteWitness)}; ${this.stats.conflictReorders}/${maxReorders} conflict reorders`)
        return
      }
      this.traces.push(trace)
      this.commitTrace(trace, branch.connection.name)
      this.stats.routedBranches++
      this.progress = this.traces.length / Math.max(1, this.branches.length)
    } else {
      this.traces = acceptKrtBranches({ original: this.srj, branches: this.branches, proposed: this.traces, gridStep: 1e-7 })
      this.stats.acceptedAgainstOriginalInput = true
      this.stats.acceptedBranches = this.traces.length
      this.stats.acceptedThroughVias = this.traces.reduce((count, trace) => count + trace.route.filter((point) => point.route_type === "via").length, 0)
      this.stats.acceptedUniqueThroughVias = new Set(this.traces.flatMap((trace) => trace.route.filter((point) => point.route_type === "via").map((point) => `${point.x},${point.y}`))).size
      this.solved = true
      this.currentPipelineStepIndex = 1
      this.endTimeOfPhase.geometryVisibilitySolver = performance.now()
    }
    } finally {
      this.timeSpentOnPhase.geometryVisibilitySolver = (this.timeSpentOnPhase.geometryVisibilitySolver ?? 0) + performance.now() - phaseStart
    }
  }

  getOutputSimplifiedPcbTraces(): SimplifiedPcbTraces {
    if (!this.solved) throw new Error("Cannot get geometry output before original-input qualification")
    return this.traces
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    return { ...structuredClone(this.srj), traces: this.getOutputSimplifiedPcbTraces() }
  }

  visualize(): GraphicsObject {
    return convertSrjToGraphicsObject({ ...this.srj, traces: this.solved ? this.traces : [] })
  }
}
