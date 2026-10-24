import { distance } from "@tscircuit/math-utils"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "./SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

type SharedQuery = ReturnType<SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost["getPlanarNeighborObstacleQuery"]>
type SourceRecord = { source: Node; x: number; y: number; z: number; revision: number; initialized: boolean; query: SharedQuery }
type Point = { x: number; y: number; z: number }

/**
 * Depth-one lazy validation on the native grid. Every expanded parent is
 * certified; only its incoming planar edge can be unknown. Thus an invalid
 * edge has no expanded descendants and needs no subtree rewiring. Via checks
 * remain eager and use the actual certified parent chain.
 *
 * This changes failure-key closure, queue contents and the iteration clock.
 * It does not claim native route parity, optimality or history completeness.
 * The original MAX_ITERATIONS/effort remain unchanged: a deferred rejection
 * consumes a step, and every new action is additionally counted below.
 */
export class LazyPhysicalSingleHighDensityRouteSolver extends SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  static detailedWorkDiagnostics = false
  readonly detailedWorkDiagnosticsEnabled = LazyPhysicalSingleHighDensityRouteSolver.detailedWorkDiagnostics
  readonly lazyPhysicalDiagnostics: Record<string, number> = this.detailedWorkDiagnosticsEnabled ? {
    lazyInstances: 1, lazyWorkUnits: 1, lazyQueuePushes: 1, lazyQueuePops: 0,
    lazySourceRecords: 0, lazySharedQueryBuilds: 0, lazyPointQueryAdapters: 0,
    lazyNodeConstructions: 0, lazyStepCalls: 0, lazyContextChecks: 0,
    lazyPlanarProposals: 0, lazyViaProposals: 0, lazyCostEvaluations: 0,
    lazyPointChecks: 0, lazySegmentChecks: 0, lazyEdgeChecks: 0,
    lazyViaChecks: 0, lazyValidatedPlanar: 0, lazyRejectedPlanar: 0,
    lazyKnownBlockedPointHits: 0, lazyStalePops: 0, lazyExpanded: 0,
    lazyGoalChecks: 0, lazyWitnessEdges: 0, lazyWitnessRejected: 0,
  } : { lazyInstances: 1 }
  private pending = new WeakMap<Node, SourceRecord>()
  private certified = new WeakSet<Node>()
  private blockedPoints = new Map<number, Point>()
  declare private sceneRevision: number
  private aggregateDiagnostics?: Record<string, number>
  private initialWitness?: Node

  constructor(opts: ConstructorParameters<typeof SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost>[0], aggregateDiagnostics?: Record<string, number>) {
    super(opts)
    this.aggregateDiagnostics = aggregateDiagnostics
    if (aggregateDiagnostics && this.detailedWorkDiagnosticsEnabled) {
      aggregateDiagnostics.lazyDetailedInstances = (aggregateDiagnostics.lazyDetailedInstances ?? 0) + 1
    }
    if (aggregateDiagnostics) for (const [key, value] of Object.entries(this.lazyPhysicalDiagnostics)) {
      aggregateDiagnostics[key] = (aggregateDiagnostics[key] ?? 0) + value
    }
    const initial = this.candidates.peek()
    if (!initial) throw new Error("Missing native initial candidate")
    const root = initial.parent ?? initial
    if (root.parent || root.x !== this.A.x || root.y !== this.A.y || root.z !== this.A.z) {
      throw new Error("Unexpected native initial witness")
    }
    // The native constructor has already checked a nontrivial snapped edge.
    // A coincident initial parent is a terminal marker, not a new copper edge.
    this.initialWitness = initial
    this.certified.add(root)
    this.certified.add(initial)
  }
  private activeContext?: { revision: number; minX: number; maxX: number; minY: number; maxY: number;
    step: number; width: number; margin: number; nearby: number; via: number; layers: string }

  private assertActiveContext(): void {
    this.charge("lazyContextChecks")
    const c = this.activeContext
    if (!c) {
      this.activeContext = { revision: this.sceneRevision, ...this.bounds, step: this.cellStep,
        width: this.traceThickness, margin: this.obstacleMargin, nearby: this.NEARBY_SEGMENT_CLEARANCE,
        via: this.viaDiameter, layers: this.availableZ.join(",") }
      return
    }
    if (c.revision !== this.sceneRevision || c.minX !== this.bounds.minX || c.maxX !== this.bounds.maxX ||
      c.minY !== this.bounds.minY || c.maxY !== this.bounds.maxY || c.step !== this.cellStep ||
      c.width !== this.traceThickness || c.margin !== this.obstacleMargin ||
      c.nearby !== this.NEARBY_SEGMENT_CLEARANCE || c.via !== this.viaDiameter || c.layers !== this.availableZ.join(",")) {
      throw new Error("Lazy physical context changed during active search")
    }
  }

  override buildObstacleIndexes(): void {
    // Retain the revision created during the base constructor. There are no
    // pending records then; later rebuilds invalidate active context/records.
    this.sceneRevision = (this.sceneRevision ?? 0) + 1
    super.buildObstacleIndexes()
    this.blockedPoints?.clear()
  }

  private charge(name: string): void {
    if (!this.detailedWorkDiagnosticsEnabled) return
    this.lazyPhysicalDiagnostics[name] = (this.lazyPhysicalDiagnostics[name] ?? 0) + 1
    this.lazyPhysicalDiagnostics.lazyWorkUnits++
    if (this.aggregateDiagnostics) {
      this.aggregateDiagnostics[name] = (this.aggregateDiagnostics[name] ?? 0) + 1
      this.aggregateDiagnostics.lazyWorkUnits = (this.aggregateDiagnostics.lazyWorkUnits ?? 0) + 1
    }
  }

  override getNeighbors(node: Node): Node[] {
    if (!this.certified.has(node)) throw new Error("Lazy expansion requires a certified parent")
    const neighbors: Node[] = []
    let record: SourceRecord | undefined
    const { minX, maxX, minY, maxY } = this.bounds
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
      if (x === 0 && y === 0) continue
      const candidate: Node = { x: Math.max(minX, Math.min(maxX, node.x + x * this.cellStep)),
        y: Math.max(minY, Math.min(maxY, node.y + y * this.cellStep)), z: node.z,
        g: node.g, h: node.h, f: node.f, parent: node }
      this.charge("lazyNodeConstructions")
      const key = this.getNodeKey(candidate)
      if (this.exploredNodes.has(key)) continue
      this.charge("lazyPlanarProposals")
      // Scalar boundary rejection stays cheap/eager. Expensive point/segment
      // geometry is deferred; do not poison an aliased coordinate key here.
      this.charge("lazyEdgeChecks")
      if (this.isNodeTooCloseToEdge(candidate, false)) continue
      if (!record) {
        this.charge("lazySourceRecords")
        record = { source: node, x: node.x, y: node.y, z: node.z, revision: this.sceneRevision, initialized: false, query: undefined }
      }
      this.charge("lazyCostEvaluations")
      this.setNodeCosts(candidate)
      this.pending.set(candidate, record)
      neighbors.push(candidate)
    }
    for (const z of this.availableZ) {
      if (z === node.z) continue
      const candidate: Node = { x: node.x, y: node.y, z, g: node.g, h: node.h, f: node.f, parent: node }
      this.charge("lazyNodeConstructions")
      if (this.exploredNodes.has(this.getNodeKey(candidate))) continue
      this.charge("lazyViaProposals")
      this.charge("lazyViaChecks")
      if (this.isNodeTooCloseToObstacle(candidate, this.viaDiameter / 2 + this.obstacleMargin / 2, true)) continue
      this.charge("lazyEdgeChecks")
      if (this.isNodeTooCloseToEdge(candidate, true)) continue
      this.charge("lazyCostEvaluations")
      this.setNodeCosts(candidate)
      this.certified.add(candidate)
      neighbors.push(candidate)
    }
    return neighbors
  }

  private validatePlanar(node: Node, record: SourceRecord): boolean {
    if (record.revision !== this.sceneRevision) throw new Error("Lazy physical scene changed during active search")
    if (node.parent !== record.source || !this.certified.has(record.source) || record.source.x !== record.x || record.source.y !== record.y || record.source.z !== record.z) throw new Error("Lazy physical parent witness changed")
    const key = this.getNodeKey(node), blocked = this.blockedPoints.get(key)
    if (blocked && blocked.x === node.x && blocked.y === node.y && blocked.z === node.z) {
      this.charge("lazyKnownBlockedPointHits")
      return false
    }
    if (!record.initialized) {
      this.charge("lazySharedQueryBuilds")
      record.query = this.getPlanarNeighborObstacleQuery(record.source)
      record.initialized = true
    }
    this.charge("lazyPointQueryAdapters")
    const query = this.getPlanarObstacleQuery(node, record.query, key)
    this.charge("lazyPointChecks")
    if (this.isNodeTooCloseToObstacle(node, undefined, false, query)) {
      this.blockedPoints.set(key, { x: node.x, y: node.y, z: node.z })
      return false
    }
    this.charge("lazySegmentChecks")
    if (this.doesPathToParentIntersectObstacle(node, query)) return false
    this.certified.add(node)
    this.pending.delete(node)
    this.charge("lazyValidatedPlanar")
    return true
  }

  private validateWitness(node: Node): boolean {
    const seen = new Set<Node>()
    for (let current: Node | null = node; current?.parent; current = current.parent) {
      if (seen.has(current)) throw new Error("Cyclic lazy parent witness")
      seen.add(current)
      if (!this.certified.has(current) || !this.certified.has(current.parent)) throw new Error("Unchecked lazy parent witness")
      if (current === this.initialWitness && current.x === current.parent.x && current.y === current.parent.y && current.z === current.parent.z) continue
      this.charge("lazyWitnessEdges")
      if (current.z !== current.parent.z) {
        this.charge("lazyViaChecks")
        if (this.isNodeTooCloseToObstacle(current, this.viaDiameter / 2 + this.obstacleMargin / 2, true)) return false
        this.charge("lazyEdgeChecks")
        if (this.isNodeTooCloseToEdge(current, true)) return false
      } else {
        this.charge("lazyPointChecks")
        if (this.isNodeTooCloseToObstacle(current)) return false
        this.charge("lazyEdgeChecks")
        if (this.isNodeTooCloseToEdge(current, false)) return false
        this.charge("lazySegmentChecks")
        if (this.doesPathToParentIntersectObstacle(current)) return false
      }
    }
    // Native goal attachment has a whole-segment test, not a new full-margin
    // destination point test. Preserve that terminal contract exactly.
    this.charge("lazySegmentChecks")
    return !this.doesPathToParentIntersectObstacle({ ...node, parent: node, x: this.B.x, y: this.B.y })
  }

  override _step(): void {
    this.charge("lazyStepCalls")
    this.assertActiveContext()
    let current = this.candidates.dequeue()
    this.charge("lazyQueuePops")
    let key = current ? this.getNodeKey(current) : undefined
    while (current && key && this.exploredNodes.has(key)) {
      this.charge("lazyStalePops")
      current = this.candidates.dequeue()
      this.charge("lazyQueuePops")
      key = current ? this.getNodeKey(current) : undefined
    }
    // Preserve the native key0 behavior; this experiment does not silently
    // combine a preexisting coordinate-key policy correction with laziness.
    if (!current || !key) {
      this.failed = true
      this.error = "Ran out of candidate nodes to explore"
      return
    }
    const record = this.pending.get(current)
    if (record && !this.validatePlanar(current, record)) {
      this.charge("lazyRejectedPlanar")
      return
    }
    if (!this.certified.has(current)) {
      if (current.parent || current.x !== this.A.x || current.y !== this.A.y || current.z !== this.A.z) throw new Error("Unknown lazy root witness")
      this.certified.add(current)
    }
    this.exploredNodes.add(key)
    this.charge("lazyExpanded")
    if (this.debugEnabled) this.debug_exploredNodesOrdered.push({ key,
      x: Math.round(current.x / this.cellStep) * this.cellStep + this.initialNodeGridOffset.x,
      y: Math.round(current.y / this.cellStep) * this.cellStep + this.initialNodeGridOffset.y, z: current.z })
    const goalDist = distance(current, this.B)
    this.progress = this.computeProgress(current, goalDist, current.z === this.B.z)
    if (goalDist <= this.cellStep * Math.SQRT2 && current.z === this.B.z) {
      this.charge("lazyGoalChecks")
      if (this.validateWitness(current)) {
        this.setSolvedPath(current)
        this.solved = true
        return
      }
      this.charge("lazyWitnessRejected")
    }
    for (const candidate of this.getNeighbors(current)) {
      this.charge("lazyQueuePushes")
      this.candidates.enqueue(candidate)
    }
  }
}
