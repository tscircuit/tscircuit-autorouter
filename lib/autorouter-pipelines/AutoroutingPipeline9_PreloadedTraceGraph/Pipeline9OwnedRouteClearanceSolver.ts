import { FindClearancePathSolver } from "@tscircuit/repair04"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Pipeline9RegionalB01RepairParams } from "./applyPipeline9RegionalB01Repairs"
import { getPipeline9DrcErrors, getPipeline9DrcErrorTraceIds, getPipeline9RouteIndexByTraceId, isPipeline9DrcCandidateBetter, type Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"

type Params = Pipeline9RegionalB01RepairParams & { viaHoleDiameter: number }
type Problem = { solver: FindClearancePathSolver; routeIndex: number }

/** Complete owned-route candidates preserve the already certified endpoints. */
export class Pipeline9OwnedRouteClearanceSolver extends BaseSolver {
  private routes: HighDensityRoute[]
  private errors: Pipeline9DrcError[] = []
  private phase: "initialize" | "prepare" | "search" | "validate" = "initialize"
  private candidates: Array<{ routeIndex: number; scale: number }> = []
  private candidateIndex = 0
  private pass = 0
  private acceptedOnPass = false
  private problem?: Problem

  constructor(private readonly params: Params) {
    super()
    this.routes = params.routes
    this.MAX_ITERATIONS = 32 + 8 * params.routes.length
    this.stats = { ownedRouteRepairTrials: 0, ownedRouteRepairAccepted: 0, ownedRouteRepairNullSearches: 0, ownedRouteRepairNodesPopped: 0, ownedRouteRepairNodeLimits: 0, ownedRouteRepairProtectedRoutes: 0 }
  }

  private preparePass(): void {
    const byTraceId = getPipeline9RouteIndexByTraceId({ routes: this.routes, newConnections: this.params.newConnections, syntheticConnectionNames: this.params.syntheticConnectionNames })
    const indexes = [...new Set(this.errors.flatMap(getPipeline9DrcErrorTraceIds).flatMap((id) => {
      const index = byTraceId.get(id)
      return index === undefined ? [] : [index]
    }))]
    const eligible = indexes.filter((index) => {
      const route = this.routes[index]!
      return !route.jumpers?.length && !route.route.some((point) => point.insideJumperPad || point.toNextSegmentType)
    })
    // A complete-path replacement has no certificate for changing protected
    // plated-hole/jumper primitives; leave those to their native repair domain.
    this.stats.ownedRouteRepairProtectedRoutes = indexes.length - eligible.length
    this.candidates = eligible.flatMap((routeIndex) => [1, 2, 4].map((scale) => ({ routeIndex, scale })))
    this.candidateIndex = 0
    this.acceptedOnPass = false
    this.stats.ownedRouteRepairEligible = eligible.length
    this.phase = "prepare"
  }

  override _step(): void {
    if (this.phase === "initialize") {
      this.errors = getPipeline9DrcErrors(this.params.drcEvaluator, this.routes)
      this.stats.ownedRouteRepairInitialIssues = this.errors.length
      this.preparePass()
      return
    }
    if (this.phase === "prepare") {
      if (this.errors.length === 0 || this.candidateIndex >= this.candidates.length) {
        if (this.errors.length > 0 && this.acceptedOnPass && this.pass === 0) {
          this.pass++
          this.preparePass()
          return
        }
        this.stats.ownedRouteRepairFinalIssues = this.errors.length
        this.solved = true
        return
      }
      const { routeIndex, scale } = this.candidates[this.candidateIndex++]!
      const currentIds = new Set(this.errors.flatMap(getPipeline9DrcErrorTraceIds))
      const indexByTrace = getPipeline9RouteIndexByTraceId({ routes: this.routes, newConnections: this.params.newConnections, syntheticConnectionNames: this.params.syntheticConnectionNames })
      if (![...currentIds].some((id) => indexByTrace.get(id) === routeIndex)) return
      const route = this.routes[routeIndex]!
      const xs = route.route.map((point) => point.x), ys = route.route.map((point) => point.y)
      if (xs.length < 2 || ![...xs, ...ys].every(Number.isFinite)) throw new Error(`Owned route ${route.connectionName} has invalid geometry`)
      const margin = 2 * scale * (this.params.obstacleMargin + Math.max(route.traceThickness, route.viaDiameter))
      const bounds = { minX: Math.max(this.params.srj.bounds.minX, Math.min(...xs) - margin), maxX: Math.min(this.params.srj.bounds.maxX, Math.max(...xs) + margin),
        minY: Math.max(this.params.srj.bounds.minY, Math.min(...ys) - margin), maxY: Math.min(this.params.srj.bounds.maxY, Math.max(...ys) + margin) }
      const solver = new FindClearancePathSolver({
        // Fixed preload HD roots use ConnectivityMap's canonical IDs. Carry
        // that certified alias into this private search, whose net union also
        // sees the original PCB pad/connection names.
        srj: { ...this.params.srj, traces: undefined, connections: [...this.params.srj.connections, ...this.params.newConnections].map((connection) => {
          const canonical = this.params.connMap.getNetConnectedToId(connection.name)
          return canonical ? { ...connection, __rootConnectionNames: [...new Set([...(connection.__rootConnectionNames ?? []), canonical])] } : connection
        }) },
        routes: [...this.routes, ...this.params.fixedObstacleRoutes], routeIndex, start: route.route[0]!, end: route.route.at(-1)!, bounds,
        traceThickness: route.traceThickness, traceClearance: this.params.srj.minTraceToPadEdgeClearance ?? this.params.obstacleMargin,
        viaClearance: this.params.srj.minPadEdgeToPadEdgeClearance ?? this.params.obstacleMargin,
        // Resolve the board's narrowest declared routing geometry, including
        // when this particular route is wider than the minimum-width copper.
        gridSize: Math.min(0.1, route.traceThickness / 2, this.params.srj.minTraceWidth / 2), viaHoleDiameter: this.params.viaHoleDiameter,
      })
      this.stats.ownedRouteRepairTrials++
      this.problem = { solver, routeIndex }
      this.activeSubSolver = solver
      this.MAX_ITERATIONS += solver.MAX_ITERATIONS + 4
      this.phase = "search"
      return
    }
    const problem = this.problem
    if (!problem) throw new Error("Owned route clearance is missing its candidate")
    if (this.phase === "search") {
      problem.solver.step()
      this.MAX_ITERATIONS = Math.max(this.MAX_ITERATIONS, this.iterations + problem.solver.MAX_ITERATIONS - problem.solver.iterations + 4)
      if (problem.solver.failed) throw new Error(`Owned route clearance search failed: ${problem.solver.error}`)
      if (problem.solver.solved) {
        this.activeSubSolver = null
        this.phase = "validate"
      }
      return
    }
    this.stats.ownedRouteRepairNodesPopped += problem.solver.stats.nodesPopped
    if (problem.solver.stats.completionReason === "node-limit") this.stats.ownedRouteRepairNodeLimits++
    const path = problem.solver.getOutput()
    if (path) {
      const original = this.routes[problem.routeIndex]!
      const vias: HighDensityRoute["vias"] = []
      for (let index = 1; index < path.length; index++) {
        const a = path[index - 1]!, b = path[index]!
        if (a.z === b.z || a.toNextSegmentType === "through_obstacle") continue
        if (a.x !== b.x || a.y !== b.y) throw new Error("Owned route clearance created a diagonal via")
        if (!vias.some((via) => via.x === a.x && via.y === a.y)) vias.push({ x: a.x, y: a.y })
      }
      for (const [before, after] of [[original.route[0]!, path[0]!], [original.route.at(-1)!, path.at(-1)!]]) {
        if (before!.x !== after!.x || before!.y !== after!.y || before!.z !== after!.z || before!.pcb_port_id !== after!.pcb_port_id) throw new Error(`Owned route clearance changed a certified endpoint of ${original.connectionName}`)
      }
      const candidate = this.routes.map((route, index) => index === problem.routeIndex ? { ...route, route: path, vias } : route)
      const errors = getPipeline9DrcErrors(this.params.drcEvaluator, candidate)
      if (isPipeline9DrcCandidateBetter(errors, this.errors)) {
        this.routes = candidate
        this.errors = errors
        this.stats.ownedRouteRepairAccepted++
        this.acceptedOnPass = true
      }
    } else this.stats.ownedRouteRepairNullSearches++
    this.problem = undefined
    this.phase = "prepare"
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved || this.failed) throw new Error("Owned route clearance is incomplete")
    return this.routes
  }
}
