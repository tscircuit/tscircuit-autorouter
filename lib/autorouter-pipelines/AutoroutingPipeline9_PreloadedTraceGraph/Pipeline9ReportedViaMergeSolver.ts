import {
  getFixedObstacleViolations,
  getNewViaPadViolations,
} from "@tscircuit/repair04"
import { SameNetViaMergerSolver } from "@tscircuit/trace-simplification-solver"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import { getPipeline9NetByConnectionName } from "./getPipeline9NetByConnectionName"

export type Pipeline9ReportedViaMergesResult = {
  routes: HighDensityRoute[]
  referenceResult: ReturnType<DrcEvaluator>
  referenceValidationCount: number
  accepted: boolean
}

export type Pipeline9ReportedViaMergeParams = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  connMap: ConnectivityMap
  drcEvaluator: DrcEvaluator
  referenceResult?: ReturnType<DrcEvaluator>
}

type ViaMergePhase =
  | "initialize"
  | "merge"
  | "physical-check"
  | "reference-check"
  | "done"

/** Steps reported same-net merges, then validates the complete proposal. */
export class Pipeline9ReportedViaMergeSolver extends BaseSolver {
  readonly params: Pipeline9ReportedViaMergeParams
  merger?: SameNetViaMergerSolver
  result?: Pipeline9ReportedViaMergesResult
  private phase: ViaMergePhase = "initialize"
  private physicalSrj?: Omit<SimpleRouteJson, "traces"> & { traces: undefined }
  private movableRoutes: HighDensityRoute[] = []
  private candidateRoutes?: HighDensityRoute[]
  private beforeErrorCount = 0

  constructor(params: Pipeline9ReportedViaMergeParams) {
    super()
    this.params = params
    this.MAX_ITERATIONS = 1_000_004
  }

  private initializeMerge(): void {
    const { srj, routes, connMap, drcEvaluator, referenceResult } = this.params
    const beforeReference =
      referenceResult ?? drcEvaluator({ traces: [], routes, hdRoutes: routes })
    this.result = {
      routes,
      referenceResult: beforeReference,
      referenceValidationCount: referenceResult === undefined ? 1 : 0,
      accepted: false,
    }
    const beforeErrors = Array.isArray(beforeReference)
      ? beforeReference
      : beforeReference.errors
    this.beforeErrorCount = beforeErrors.length
    const traceIds = beforeErrors
      .filter((error): boolean => error.type === "pcb_via_clearance_error")
      .flatMap(getDrcErrorTraceIds)
    this.movableRoutes = routes.filter((route): boolean =>
      traceIds.some(
        (traceId): boolean =>
          traceId === route.connectionName ||
          traceId.startsWith(`${route.connectionName}_`),
      ),
    )
    if (this.movableRoutes.length === 0) {
      this.phase = "done"
      this.solved = true
      return
    }
    this.physicalSrj = {
      ...createSrjWithBoardValidObstacleLayers(srj),
      traces: undefined,
    }
    const movable = new Set(this.movableRoutes)
    this.merger = new SameNetViaMergerSolver({
      inputHdRoutes: this.movableRoutes,
      otherHdRoutes: routes.filter((route): boolean => !movable.has(route)),
      netByConnectionName: getPipeline9NetByConnectionName(routes, connMap),
      obstacles: this.physicalSrj.obstacles,
      layerCount: this.physicalSrj.layerCount,
      connMap,
      colorMap: {},
      preserveRouteEndpoints: true,
    })
    this.MAX_ITERATIONS = this.merger.MAX_ITERATIONS + 4
    this.activeSubSolver = this.merger
    this.phase = "merge"
  }

  private stepMerge(): void {
    const merger = this.merger
    if (!merger) throw new Error("Reported via merge has no active merger")
    merger.step()
    if (merger.failed) {
      throw new Error(`Reported via merge failed: ${merger.error}`)
    }
    if (!merger.solved) return
    if (merger.mergedViaHdRoutes.length !== this.movableRoutes.length) {
      throw new Error("Reported via merge changed the number of route pieces")
    }
    const mergedByRoute = new Map(
      this.movableRoutes.map((route, index) => [
        route,
        merger.mergedViaHdRoutes[index]!,
      ]),
    )
    this.candidateRoutes = this.params.routes.map(
      (route): HighDensityRoute => mergedByRoute.get(route) ?? route,
    )
    this.activeSubSolver = null
    this.phase = "physical-check"
  }

  private validatePhysicalProposal(): void {
    const srj = this.physicalSrj
    const candidateRoutes = this.candidateRoutes
    if (!srj || !candidateRoutes) {
      throw new Error("Reported via merge has no physical proposal")
    }
    const routes = this.params.routes
    const beforeFixed = new Map(
      getFixedObstacleViolations({ srj, routes }).map(({ key, severity }) => [
        key,
        severity,
      ]),
    )
    const candidateFixed = getFixedObstacleViolations({
      srj,
      routes: candidateRoutes,
    })
    if (
      !candidateFixed.every(
        ({ key, severity }): boolean =>
          beforeFixed.has(key) && severity <= beforeFixed.get(key)! + 1e-8,
      ) ||
      getNewViaPadViolations({
        srj,
        previousRoutes: routes,
        routes: candidateRoutes,
      }).length > 0
    ) {
      this.phase = "done"
      this.solved = true
      return
    }
    this.phase = "reference-check"
  }

  private validateReferenceProposal(): void {
    const result = this.result
    const routes = this.candidateRoutes
    if (!result || !routes) {
      throw new Error("Reported via merge has no reference proposal")
    }
    const referenceResult = this.params.drcEvaluator({
      traces: [],
      routes,
      hdRoutes: routes,
    })
    result.referenceValidationCount++
    const errors = Array.isArray(referenceResult)
      ? referenceResult
      : referenceResult.errors
    if (errors.length < this.beforeErrorCount) {
      this.result = { ...result, routes, referenceResult, accepted: true }
    }
    this.phase = "done"
    this.solved = true
  }

  override _step(): void {
    switch (this.phase) {
      case "initialize":
        return this.initializeMerge()
      case "merge":
        return this.stepMerge()
      case "physical-check":
        return this.validatePhysicalProposal()
      case "reference-check":
        return this.validateReferenceProposal()
      case "done":
        throw new Error("Reported via merge was stepped after completion")
    }
  }

  getResult(): Pipeline9ReportedViaMergesResult {
    if (!this.solved || this.failed || !this.result) {
      throw new Error("Reported via merge is not complete")
    }
    return this.result
  }
}
