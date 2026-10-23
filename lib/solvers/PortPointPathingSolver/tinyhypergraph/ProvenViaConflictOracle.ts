import { mapLayerNameToZ } from "../../../utils/mapLayerNameToZ"
import type { Candidate, TinyHyperGraphSolver, TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"
import type { Obstacle, SimpleRouteJson } from "../../../types/srj-types"

type Rect = { minX: number; maxX: number; minY: number; maxY: number }
type RegionGeometry = { center?: { x: number; y: number }; width?: number; height?: number; capacityMeshNodeId?: string }
type SolverFactory = { createGreedyFinalRouteSolver(options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver }
export type ViaConflictContext = {
  obstacles: Obstacle[]
  viaDiameter: number
  layerCount: number
  clearance: number
  allowBlindAndBuriedVias: boolean
}

/** Only a clearance lower bound shared by all certifying keepouts can support a hard cut. */
export function getProvenViaConflictContext(srj: SimpleRouteJson, viaDiameter: number): ViaConflictContext {
  return {
    obstacles: srj.obstacles,
    viaDiameter,
    layerCount: srj.layerCount,
    clearance: Math.min(srj.defaultObstacleMargin ?? 0, srj.minViaEdgeToPadEdgeClearance ?? srj.defaultObstacleMargin ?? 0),
    allowBlindAndBuriedVias: srj.allowBlindAndBuriedVias === true,
  }
}

/** Exact rectangle-union coverage; rectangles supplied here underapproximate forbidden via centers. */
export function isRectangleCovered(region: Rect, forbidden: Rect[]): boolean {
  const xs = [...new Set([region.minX, region.maxX, ...forbidden.flatMap((r) => [Math.max(region.minX, r.minX), Math.min(region.maxX, r.maxX)]).filter((x) => x >= region.minX && x <= region.maxX)])].sort((a, b) => a - b)
  for (let i = 1; i < xs.length; i++) {
    const x = (xs[i - 1]! + xs[i]!) / 2
    const intervals = forbidden.filter((r) => r.minX <= x && x <= r.maxX).map((r) => ({ min: r.minY, max: r.maxY })).sort((a, b) => a.min - b.min)
    let covered = region.minY
    for (const interval of intervals) {
      if (interval.min > covered) break
      covered = Math.max(covered, interval.max)
      if (covered >= region.maxY) break
    }
    if (covered < region.maxY) return false
  }
  return xs.length > 1
}

/** Learns hard region/transition cuts only after a queried candidate needs a via. */
export class ProvenViaConflictOracle {
  readonly stats = { viaConflictQueries: 0, viaFeasibilityChecks: 0, learnedViaRegionCuts: 0, reusedViaRegionCuts: 0, rejectedViaTransitions: 0, inconclusiveViaRegions: 0 }
  private readonly feasibility = new Map<string, boolean>()
  private readonly installed = new WeakSet<TinyHyperGraphSolver>()
  private readonly forbidden: Rect[]

  constructor(private readonly context: ViaConflictContext) {
    if (!Number.isInteger(context.layerCount) || context.layerCount < 1 || !(context.viaDiameter > 0) || !Number.isFinite(context.viaDiameter) || context.clearance < 0 || !Number.isFinite(context.clearance)) throw new Error("Via conflict oracle requires finite positive diameter and nonnegative clearance")
    const radius = context.viaDiameter / 2 + context.clearance
    this.forbidden = context.allowBlindAndBuriedVias ? [] : context.obstacles.flatMap((o) => {
      // A through via touches every copper layer. Only unconditional, unconnected
      // axis-aligned rectangles can certify a cut independent of route ownership.
      if (o.isCopperPour || o.connectedTo.length > 0 || o.netIsAssignable || o.offBoardConnectsTo?.length || o.shape !== undefined || (o.ccwRotationDegrees ?? 0) % 180 !== 0) return []
      const zs = o.__zLayers ?? o.zLayers ?? o.layers.map((layer) => mapLayerNameToZ(layer, context.layerCount))
      if (zs.length === 0 || zs.some((z) => !Number.isInteger(z) || z < 0 || z >= context.layerCount)) return []
      if (![o.center.x, o.center.y, o.width, o.height].every(Number.isFinite) || o.width <= 0 || o.height <= 0) throw new Error("Via conflict oracle has invalid obstacle geometry")
      const minX = o.center.x - o.width / 2
      const maxX = o.center.x + o.width / 2
      const minY = o.center.y - o.height / 2
      const maxY = o.center.y + o.height / 2
      // Two open-interior strips form a subset of the rounded Minkowski sum.
      // Expanding the whole AABB would be UNSOUND at rectangle corners.
      const epsilon = 1e-8
      return [
        { minX: minX - radius + epsilon, maxX: maxX + radius - epsilon, minY: minY + epsilon, maxY: maxY - epsilon },
        { minX: minX + epsilon, maxX: maxX - epsilon, minY: minY - radius + epsilon, maxY: maxY + radius - epsilon },
      ].filter((r) => r.minX < r.maxX && r.minY < r.maxY)
    })
  }

  rejectsTransition(region: RegionGeometry, fromZ: number, toZ: number): boolean {
    if (fromZ === toZ || this.forbidden.length === 0) return false
    this.stats.viaConflictQueries++
    if (!region.center || ![region.center.x, region.center.y, region.width, region.height].every((v) => typeof v === "number" && Number.isFinite(v)) || !(region.width! > 0) || !(region.height! > 0)) {
      this.stats.inconclusiveViaRegions++
      return false
    }
    const bounds = { minX: region.center.x - region.width! / 2, maxX: region.center.x + region.width! / 2, minY: region.center.y - region.height! / 2, maxY: region.center.y + region.height! / 2 }
    const key = `${bounds.minX},${bounds.maxX},${bounds.minY},${bounds.maxY}`
    let blocked = this.feasibility.get(key)
    if (blocked === undefined) {
      this.stats.viaFeasibilityChecks++
      blocked = isRectangleCovered(bounds, this.forbidden.filter((r) => r.minX <= bounds.maxX && r.maxX >= bounds.minX && r.minY <= bounds.maxY && r.maxY >= bounds.minY))
      this.feasibility.set(key, blocked)
      if (blocked) this.stats.learnedViaRegionCuts++
    } else if (blocked) {
      this.stats.reusedViaRegionCuts++
    }
    if (blocked) this.stats.rejectedViaTransitions++
    return blocked
  }

  install(solver: TinyHyperGraphSolver): void {
    if (this.installed.has(solver)) return
    this.installed.add(solver)
    let expansionCandidate: Candidate | undefined
    let guardedQueue: typeof solver.state.candidateQueue | undefined
    const nativeStep = solver._step.bind(solver)
    solver._step = (): void => {
      // Distance-aware and selective-rerip setup replaces the constructor heap.
      // Attach after setup and refresh for every later heap replacement too.
      const currentQueue = solver.state.candidateQueue
      if (guardedQueue !== currentQueue) {
        const nativeDequeue = currentQueue.dequeue.bind(currentQueue)
        currentQueue.dequeue = (): Candidate | undefined => {
          expansionCandidate = nativeDequeue()
          return expansionCandidate
        }
        guardedQueue = currentQueue
      }
      expansionCandidate = undefined
      try {
        nativeStep()
      } finally {
        expansionCandidate = undefined
      }
    }
    // Native goal-region shortcuts skip computeG. Apply the identical oracle
    // before goal acceptance so an impossible terminal hop cannot bypass cuts.
    const nativeReserved = solver.isPortReservedForDifferentNet.bind(solver)
    solver.isPortReservedForDifferentNet = (portId): boolean => {
      if (portId === solver.state.goalPortId && expansionCandidate) {
        const metadata = solver.topology.regionMetadata?.[expansionCandidate.nextRegionId] as RegionGeometry | undefined
        if (metadata && this.rejectsTransition(metadata, solver.topology.portZ[expansionCandidate.portId]!, solver.topology.portZ[portId]!)) return true
      }
      return nativeReserved(portId)
    }
    const nativeComputeG = solver.computeG.bind(solver)
    solver.computeG = (candidate, neighborPortId, maximumCost, knownSegmentDistance): number => {
      const metadata = solver.topology.regionMetadata?.[candidate.nextRegionId] as RegionGeometry | undefined
      if (metadata && this.rejectsTransition(metadata, solver.topology.portZ[candidate.portId]!, solver.topology.portZ[neighborPortId]!)) return Infinity
      return nativeComputeG(candidate, neighborPortId, maximumCost, knownSegmentDistance)
    }
    // Native final-route attempts create new solver instances. Keep the same
    // learned cuts on those instances rather than bypassing them at acceptance.
    const factory = solver as unknown as SolverFactory
    const nativeCreate = factory.createGreedyFinalRouteSolver.bind(solver)
    factory.createGreedyFinalRouteSolver = (options, attempt): TinyHyperGraphSolver => {
      const next = nativeCreate(options, attempt)
      this.install(next)
      return next
    }
  }
}
