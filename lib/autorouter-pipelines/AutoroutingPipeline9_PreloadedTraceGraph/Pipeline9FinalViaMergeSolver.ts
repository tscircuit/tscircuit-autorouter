import type { AnyCircuitElement } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { arePipeline9RoutesOnSameNet } from "./pipeline9FixedRouteCopper"
import { getPipeline9RouteIndexByTraceId, type Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"
import { Pipeline9ReportedViaMergeSolver } from "./Pipeline9ReportedViaMergeSolver"

type Point = { x: number; y: number }
type CircuitVia = Extract<AnyCircuitElement, { type: "pcb_via" }>
type FinalViaMergeParams = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  fixedRoutes: readonly HighDensityRoute[]
  connMap: ConnectivityMap
  newConnections: SimpleRouteConnection[]
  syntheticConnectionNames: ReadonlySet<string>
  drcEvaluator: DrcEvaluator
  prepareReference: (routes: HighDensityRoute[]) => {
    errors: Pipeline9DrcError[]
    circuitJson: AnyCircuitElement[]
  }
}
type FinalViaMergeResult = {
  routes: HighDensityRoute[]
  referenceValidationCount: number
  attempted: boolean
  repaired: boolean
  initialDrcIssueCount: number
  remainingDrcIssueCount: number
}

const POSITION_EPSILON = 1e-9

const pointTouchesRoute = (point: Point, route: HighDensityRoute): boolean => {
  for (const [index, end] of route.route.entries()) {
    const start = route.route[Math.max(0, index - 1)]!
    const dx = end.x - start.x, dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    if (Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy) <= POSITION_EPSILON) return true
  }
  return false
}

/** Runs the existing reported merger once on a final, single-alias residual. */
export class Pipeline9FinalViaMergeSolver extends BaseSolver {
  readonly params: FinalViaMergeParams
  merger?: Pipeline9ReportedViaMergeSolver
  private eligibleRouteIndices?: ReadonlySet<number>
  private result: FinalViaMergeResult

  constructor(params: FinalViaMergeParams) {
    super()
    this.params = params
    this.MAX_ITERATIONS = 4
    this.result = { routes: params.routes, referenceValidationCount: 0,
      attempted: false, repaired: false, initialDrcIssueCount: 0, remainingDrcIssueCount: 0 }
  }

  private getEligibleRouteIndices(errors: Pipeline9DrcError[], circuitJson: AnyCircuitElement[]): ReadonlySet<number> | undefined {
    if (errors.length !== 1) return undefined
    const error = errors[0]!
    if (error.type !== "pcb_via_clearance_error" || !Array.isArray(error.pcb_via_ids) ||
      error.pcb_via_ids.length !== 2 || error.pcb_via_ids.some((id) => typeof id !== "string") ||
      error.pcb_via_ids[0] === error.pcb_via_ids[1]) return undefined
    const viaById = new Map(circuitJson.filter((element): element is CircuitVia =>
      element.type === "pcb_via").map((via) => [via.pcb_via_id, via]))
    const pair = error.pcb_via_ids.map((id) => {
      const via = viaById.get(id as string)
      if (!via) throw new Error(`Pipeline9 final merge cannot resolve reported via "${id}"`)
      return via
    })
    // Normalization can give an immutable preload and a new trace the same
    // solver ID. Decline that ambiguous ownership rather than moving its alias.
    if (pair.some((via) => this.params.srj.traces?.some((trace) => trace.pcb_trace_id === via.pcb_trace_id))) return undefined
    const left = pair[0]!, right = pair[1]!
    if (left.hole_diameter !== right.hole_diameter || left.outer_diameter !== right.outer_diameter ||
      JSON.stringify(left.layers) !== JSON.stringify(right.layers) ||
      ![left.x, left.y, right.x, right.y].every(Number.isFinite) ||
      Math.hypot(left.x - right.x, left.y - right.y) >= Math.min(left.outer_diameter, right.outer_diameter)) return undefined
    const { routes, newConnections, syntheticConnectionNames, connMap } = this.params
    const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({ routes, newConnections, syntheticConnectionNames })
    const leftIndex = typeof left.pcb_trace_id === "string" ? routeIndexByTraceId.get(left.pcb_trace_id) : undefined
    const rightIndex = typeof right.pcb_trace_id === "string" ? routeIndexByTraceId.get(right.pcb_trace_id) : undefined
    if (leftIndex === undefined || rightIndex === undefined) return undefined
    const leftRoute = routes[leftIndex]!, rightRoute = routes[rightIndex]!
    if (syntheticConnectionNames.has(leftRoute.connectionName) || syntheticConnectionNames.has(rightRoute.connectionName) ||
      !arePipeline9RoutesOnSameNet(leftRoute, rightRoute, connMap)) return undefined
    return new Set([leftIndex, rightIndex])
  }

  private initializeMerge(): void {
    const { routes, drcEvaluator } = this.params
    const reference = drcEvaluator({ traces: [], routes, hdRoutes: routes })
    this.result.referenceValidationCount++
    const errors = Array.isArray(reference) ? reference : reference.errors
    this.result.initialDrcIssueCount = errors.length
    this.result.remainingDrcIssueCount = errors.length
    if (errors.length !== 1 || errors[0]!.type !== "pcb_via_clearance_error") {
      this.solved = true
      return
    }
    // The full circuit is requested only here and is not retained in DRC caches.
    const prepared = this.params.prepareReference(routes)
    this.result.referenceValidationCount++
    const originalIdentity = errors.map((error) => [error.type, error.pcb_via_ids,
      error.actual_clearance, error.minimum_clearance])
    const capturedIdentity = prepared.errors.map((error) => [error.type, error.pcb_via_ids,
      error.actual_clearance, error.minimum_clearance])
    if (JSON.stringify(originalIdentity) !== JSON.stringify(capturedIdentity)) {
      throw new Error("Pipeline9 final merge reference identity capture changed the unchanged board's errors")
    }
    this.eligibleRouteIndices = this.getEligibleRouteIndices(prepared.errors, prepared.circuitJson)
    if (!this.eligibleRouteIndices) {
      this.solved = true
      return
    }
    this.merger = new Pipeline9ReportedViaMergeSolver({ srj: this.params.srj,
      routes, connMap: this.params.connMap, drcEvaluator,
      referenceResult: { errors: prepared.errors, errorsWithCenters: prepared.errors } })
    this.result.attempted = true
    this.activeSubSolver = this.merger
    this.MAX_ITERATIONS += this.merger.MAX_ITERATIONS + 1
  }

  private preservesProtectedCopper(candidate: HighDensityRoute[]): boolean {
    if (!this.eligibleRouteIndices) throw new Error("Pipeline9 final merge has no eligible routes")
    const { routes, fixedRoutes } = this.params
    if (candidate.length !== routes.length) return false
    const protectedRoutes = [...fixedRoutes, ...routes.filter((_, index) => !this.eligibleRouteIndices!.has(index))]
    for (const [index, original] of routes.entries()) {
      const proposed = candidate[index]!
      if (!this.eligibleRouteIndices.has(index)) {
        if (JSON.stringify(original) !== JSON.stringify(proposed)) return false
        continue
      }
      if (original.connectionName !== proposed.connectionName || original.rootConnectionName !== proposed.rootConnectionName ||
        original.traceThickness !== proposed.traceThickness || original.viaDiameter !== proposed.viaDiameter ||
        JSON.stringify(original.jumpers) !== JSON.stringify(proposed.jumpers)) return false
      if (JSON.stringify(original.route[0]) !== JSON.stringify(proposed.route[0]) ||
        JSON.stringify(original.route.at(-1)) !== JSON.stringify(proposed.route.at(-1))) return false
      for (const [pointIndex, point] of original.route.entries()) {
        const previous = original.route[pointIndex - 1]
        const protectedPoint = pointIndex === 0 || pointIndex === original.route.length - 1 || point.pcb_port_id !== undefined ||
          point.insideJumperPad || point.toNextSegmentType === "through_obstacle" || previous?.toNextSegmentType === "through_obstacle" ||
          point.toNextSegmentCircuitJsonMetadata !== undefined || previous?.toNextSegmentCircuitJsonMetadata !== undefined
        if (protectedPoint && !proposed.route.some((candidatePoint) => JSON.stringify(candidatePoint) === JSON.stringify(point))) return false
      }
      for (const via of original.vias) {
        if (protectedRoutes.some((route) => pointTouchesRoute(via, route)) && !proposed.vias.some((candidateVia) =>
          Math.hypot(candidateVia.x - via.x, candidateVia.y - via.y) <= POSITION_EPSILON)) return false
      }
    }
    return true
  }

  override _step(): void {
    if (!this.merger) {
      this.initializeMerge()
      return
    }
    this.merger.step()
    this.MAX_ITERATIONS = Math.max(this.MAX_ITERATIONS,
      this.iterations + this.merger.MAX_ITERATIONS - this.merger.iterations + 2)
    if (this.merger.failed) {
      this.failed = true
      this.error = this.merger.error
      return
    }
    if (!this.merger.solved) return
    const mergeResult = this.merger.getResult()
    this.result.referenceValidationCount += mergeResult.referenceValidationCount
    const errors = Array.isArray(mergeResult.referenceResult) ? mergeResult.referenceResult : mergeResult.referenceResult.errors
    if (mergeResult.accepted && errors.length === 0 && this.preservesProtectedCopper(mergeResult.routes)) {
      this.result.routes = mergeResult.routes
      this.result.remainingDrcIssueCount = 0
      this.result.repaired = true
    }
    this.activeSubSolver = null
    this.solved = true
  }

  getResult(): FinalViaMergeResult {
    if (!this.solved || this.failed) {
      throw new Error("Pipeline9 final reported via merge result requested before completion")
    }
    return this.result
  }
}
