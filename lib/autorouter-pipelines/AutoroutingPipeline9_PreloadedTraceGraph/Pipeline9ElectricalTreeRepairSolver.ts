import { BaseSolver } from "lib/solvers/BaseSolver"
import { FindClearancePathSolver } from "@tscircuit/repair04"
import { assertSharedElectricalTreeRoutes } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/assertSharedElectricalTreeRoutes"
import { moveElectricalTreeJunction } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/moveElectricalTreeJunction"
import { getElectricalTreeTerminalWitness } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getElectricalTreeTerminalWitness"
import { createPipeline9ClearanceSearchOwnershipContext } from "./createPipeline9ClearanceSearchOwnershipContext"
import type { SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  type Pipeline9RegionalB01RepairParams,
  getRepairCenter,
} from "./applyPipeline9RegionalB01Repairs"
import { getPipeline9DrcErrors, getPipeline9DrcErrorTraceIds, getPipeline9RouteIndexByTraceId, isPipeline9DrcCandidateBetter, type Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"

type ElectricalTreeRepairParams = Pipeline9RegionalB01RepairParams & { preloadedTraces: readonly SimplifiedPcbTrace[]; preloadedSectionTraceIndexByConnection?: ReadonlyMap<string, number>; viaHoleDiameter: number; traceClearance: number; viaClearance: number; viaHoleClearance: number }

/** A branch is an electrical edge, so repair may replace its whole geometry. */
export class Pipeline9ElectricalTreeRepairSolver extends BaseSolver {
  readonly params: ElectricalTreeRepairParams
  private routes: HighDensityRoute[]
  private errors: Pipeline9DrcError[] = []
  private phase: "initialize" | "prepare" | "route" | "validate" = "initialize"
  private candidates: Array<{ routeIndex: number; scale: number; move?: { vertexId: string; dx: number; dy: number } }> = []
  private candidateIndex = 0
  private pass = 0
  private acceptedOnPass = false
  private problem?: { solver: FindClearancePathSolver; routes: HighDensityRoute[]; routeIndex: number }
  private junctionCandidate = false

  constructor(params: ElectricalTreeRepairParams) {
    super()
    if (![params.traceClearance, params.viaClearance, params.viaHoleClearance].every((gap) => Number.isFinite(gap) && gap >= 0)) throw new Error("Electrical tree search requires exact nonnegative reference clearances")
    this.params = params
    this.routes = params.routes
    this.MAX_ITERATIONS = 32 + 8 * params.newConnections.length
    this.stats = { electricalTreeWholeBranchTrials: 0, electricalTreeWholeBranchAccepted: 0, electricalTreeWholeBranchSearchFailed: 0, electricalTreeWholeBranchUnavailable: 0, electricalTreeJunctionRouteTrials: 0, electricalTreeJunctionRouteAccepted: 0, electricalTreeWholeBranchNodesPopped: 0, electricalTreeWholeBranchNodeLimits: 0, electricalTreeWholeBranchProtectedRoutes: 0, electricalTreeSearchConservativeCoupledViaGap: Number(params.viaClearance !== params.viaHoleClearance) }
  }

  private preparePass(): void {
    const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({ routes: this.routes, newConnections: this.params.newConnections, syntheticConnectionNames: this.params.syntheticConnectionNames })
    const physicalBranches = new Set(this.params.newConnections.filter((connection) => connection.electricalBranch).map((connection) => connection.name))
    const affectedIndexes = [...new Set(this.errors.flatMap(getPipeline9DrcErrorTraceIds).flatMap((id) => {
      const index = routeIndexByTraceId.get(id)
      return index !== undefined && (physicalBranches.has(this.routes[index]!.connectionName) || this.params.syntheticConnectionNames.has(this.routes[index]!.connectionName)) ? [index] : []
    }))]
    const indexes = affectedIndexes.filter((index) => {
      const route = this.routes[index]!
      return !route.jumpers?.length && !route.route.some((point) => point.insideJumperPad || point.toNextSegmentType)
    })
    // Whole-branch replacement does not certify plated-hole/jumper changes.
    this.stats.electricalTreeWholeBranchProtectedRoutes = affectedIndexes.length - indexes.length
    this.candidates = indexes.flatMap((routeIndex) => [1, 2, 4].map((scale) => ({ routeIndex, scale })))
    for (const routeIndex of indexes) {
      const route = this.routes[routeIndex]!
      const connection = this.params.newConnections.find((entry) => entry.name === route.connectionName)
      if (!connection?.electricalBranch) continue
      const error = this.errors.find((entry) => getPipeline9DrcErrorTraceIds(entry).includes(`${route.connectionName}_0`))!
      const center = getRepairCenter(error, this.params.srj)
      if (!center) continue
      const reach = 2 * (route.viaDiameter + route.traceThickness + this.params.obstacleMargin)
      for (const endpoint of [0, 1] as const) {
        if (connection.pointsToConnect[endpoint]!.pcb_port_id || getElectricalTreeTerminalWitness(connection, endpoint, this.params.srj.layerCount)) continue
        const point = endpoint === 0 ? route.route[0]! : route.route.at(-1)!
        const distance = Math.hypot(point.x - center.x, point.y - center.y)
        if (distance > reach || distance < 1e-9) continue
        const angle = Math.atan2(point.y - center.y, point.x - center.x)
        for (const radius of [reach / 2, reach]) {
          for (const offset of [0, -Math.PI / 4, Math.PI / 4]) {
            this.candidates.push({ routeIndex, scale: 2, move: {
              vertexId: endpoint === 0 ? connection.electricalBranch.startVertexId : connection.electricalBranch.endVertexId,
              dx: Math.cos(angle + offset) * radius, dy: Math.sin(angle + offset) * radius,
            } })
          }
        }
      }
    }
    this.candidateIndex = 0
    this.acceptedOnPass = false
    this.stats.electricalTreeWholeBranchEligible = indexes.length
    this.phase = "prepare"
  }

  override _step(): void {
    if (this.phase === "initialize") {
      this.errors = getPipeline9DrcErrors(this.params.drcEvaluator, this.routes)
      this.stats.electricalTreeWholeBranchInitialIssues = this.errors.length
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
        this.stats.electricalTreeWholeBranchFinalIssues = this.errors.length
        this.solved = true
        return
      }
      const { routeIndex, scale, move } = this.candidates[this.candidateIndex++]!
      const affectedIds = new Set(this.errors.flatMap(getPipeline9DrcErrorTraceIds))
      if (!affectedIds.has(`${this.routes[routeIndex]!.connectionName}_0`)) return
      let candidateRoutes = this.routes
      if (move) {
        this.stats.electricalTreeJunctionRouteTrials++
        const moved = moveElectricalTreeJunction({ connections: this.params.newConnections, routes: this.routes, layerCount: this.params.srj.layerCount, ...move })
        if (!moved) {
          this.stats.electricalTreeWholeBranchUnavailable++
          return
        }
        candidateRoutes = moved
      }
      const route = candidateRoutes[routeIndex]!
      if (move && [route.route[0]!, route.route.at(-1)!].some((point) => point.x < this.params.srj.bounds.minX || point.x > this.params.srj.bounds.maxX || point.y < this.params.srj.bounds.minY || point.y > this.params.srj.bounds.maxY)) {
        this.stats.electricalTreeWholeBranchUnavailable++
        return
      }
      this.junctionCandidate = move !== undefined
      const xs = route.route.map((point) => point.x), ys = route.route.map((point) => point.y)
      if (xs.length < 2 || ![...xs, ...ys].every(Number.isFinite)) throw new Error(`Electrical branch ${route.connectionName} has invalid geometry`)
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
      const margin = 2 * (this.params.obstacleMargin + Math.max(route.traceThickness, route.viaDiameter))
      this.stats.electricalTreeWholeBranchTrials++
      const bounds = { minX: Math.max(this.params.srj.bounds.minX, minX - margin * scale), maxX: Math.min(this.params.srj.bounds.maxX, maxX + margin * scale),
        minY: Math.max(this.params.srj.bounds.minY, minY - margin * scale), maxY: Math.min(this.params.srj.bounds.maxY, maxY + margin * scale) }
      // Search uses the exact reference rules; obstacleMargin still controls
      // the crop, but is a planning preference rather than a physical gap.
      const context = createPipeline9ClearanceSearchOwnershipContext({
        srj: { ...this.params.srj, defaultObstacleMargin: undefined },
        routes: candidateRoutes, fixedObstacleRoutes: this.params.fixedObstacleRoutes,
        preloadedTraces: this.params.preloadedTraces,
        preloadedSectionTraceIndexByConnection: this.params.preloadedSectionTraceIndexByConnection, connMap: this.params.connMap,
      })
      this.stats.electricalTreeSearchRouteOwnerReads = (this.stats.electricalTreeSearchRouteOwnerReads ?? 0) + context.routeOwnerReads
      this.stats.electricalTreeSearchObstacleOwnerReads = (this.stats.electricalTreeSearchObstacleOwnerReads ?? 0) + context.obstacleOwnerReads
      const solver = new FindClearancePathSolver({
        srj: context.srj,
        routes: context.routes, routeIndex,
        start: route.route[0]!, end: route.route.at(-1)!, bounds,
        traceThickness: route.traceThickness,
        traceClearance: this.params.traceClearance,
        // repair04 couples annulus and drill gaps in one input. If a board
        // declares different rules, use their conservative maximum explicitly.
        viaClearance: Math.max(this.params.viaClearance, this.params.viaHoleClearance),
        gridSize: Math.min(0.1, route.traceThickness / 2, this.params.srj.minTraceWidth / 2),
        viaHoleDiameter: this.params.viaHoleDiameter,
      })
      this.problem = { solver, routes: candidateRoutes, routeIndex }
      this.activeSubSolver = this.problem.solver
      this.MAX_ITERATIONS += this.problem.solver.MAX_ITERATIONS + 4
      this.phase = "route"
      return
    }
    const problem = this.problem
    if (!problem) throw new Error("Electrical branch repair has no candidate")
    if (this.phase === "route") {
      problem.solver.step()
      this.MAX_ITERATIONS = Math.max(this.MAX_ITERATIONS, this.iterations + problem.solver.MAX_ITERATIONS - problem.solver.iterations + 4)
      if (problem.solver.failed) {
        throw new Error(`Electrical branch path solver failed: ${problem.solver.error}`)
      } else if (problem.solver.solved) {
        this.activeSubSolver = null
        this.phase = "validate"
      }
      return
    }
    this.stats.electricalTreeWholeBranchNodesPopped += problem.solver.stats.nodesPopped
    if (problem.solver.stats.completionReason === "node-limit") this.stats.electricalTreeWholeBranchNodeLimits++
    const path = problem.solver.getOutput()
    if (!path) {
      this.stats.electricalTreeWholeBranchSearchFailed++
      this.problem = undefined
      this.phase = "prepare"
      return
    }
    const original = problem.routes[problem.routeIndex]!
    const vias: HighDensityRoute["vias"] = []
    for (let index = 1; index < path.length; index++) {
      const a = path[index - 1]!, b = path[index]!
      if (a.z === b.z || a.toNextSegmentType === "through_obstacle") continue
      if (a.x !== b.x || a.y !== b.y) throw new Error("Electrical branch path solver created a diagonal via")
      if (!vias.some((via) => via.x === a.x && via.y === a.y)) vias.push({ x: a.x, y: a.y })
    }
    const candidateRoutes = problem.routes.map((route, index) => index === problem.routeIndex ? { ...original, route: path, vias } : route)
    const branches = this.params.newConnections.filter((connection) => connection.electricalBranch)
    const names = new Set(branches.map((connection) => connection.name))
    assertSharedElectricalTreeRoutes({ connections: branches, routes: candidateRoutes.filter((route) => names.has(route.connectionName)), layerCount: this.params.srj.layerCount })
    const errors = getPipeline9DrcErrors(this.params.drcEvaluator, candidateRoutes)
    if (isPipeline9DrcCandidateBetter(errors, this.errors)) {
      this.routes = candidateRoutes
      this.errors = errors
      this.stats.electricalTreeWholeBranchAccepted++
      if (this.junctionCandidate) this.stats.electricalTreeJunctionRouteAccepted++
      this.acceptedOnPass = true
    }
    this.problem = undefined
    this.phase = "prepare"
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved || this.failed) throw new Error("Electrical tree branch repair is incomplete")
    return this.routes
  }
}
