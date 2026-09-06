import type { ExistingViaRepairTarget } from "./identifyPipeline9ViaPadRepairTargets"
import {
  Repair04Solver,
  getRepairViaGeometry,
  extractRepairRegion,
  mergeRepairRegion,
  normalizeRepairTrace,
  getFixedObstacleViolations,
  getNewViaPadViolations,
  type ExtractedRepairRegion,
} from "@tscircuit/repair04"
import {
  AutoroutingDrcEngine,
  type DrcEvaluator,
  type DrcError,
} from "high-density-repair03/lib"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertRepairRoutesToTraces } from "@tscircuit/repair04"

type Pipeline9Repair04SolverParams = {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  connMap: ConnectivityMap
  referenceDrcEvaluator: DrcEvaluator
  maxRegions?: number
  maxCandidatesPerRegion?: number
  /** Stop after this many proposals without a retained full-board improvement. */
  maxCandidateAttemptsSinceAcceptance?: number
  /** Smaller initial allowance before this stage has demonstrated a valid repair. */
  maxInitialCandidateAttempts?: number
  /** Bound all proposal attempts across this stage, including accepted repairs. */
  maxTotalCandidateAttempts?: number
  /** Scale total work down when the initial reference error count exceeds this value. */
  fullEffortReferenceErrorCount?: number
  /** Bound A* heap pops across regions until a full-board improvement is retained. */
  maxPathSearchNodesSinceAcceptance?: number
  /** Limit one crop so unsuccessful searches can still try larger bounds. */
  maxPathSearchNodesPerRegion?: number
  allowLayerChanges?: boolean
  /** Skip the child's repeated planar phase only when layer changes are permitted. */
  traceOnlyFirst?: boolean
  /** Relocate only reference-identified offending existing vias; never creates a via. */
  allowExistingViaRelocation?: boolean
}

/** Owns board state; the external solver receives only one cropped region. */
export class Pipeline9Repair04Solver extends BaseSolver {
  private routes: HighDensityRoute[]
  private readonly engine: AutoroutingDrcEngine
  private localSolver: Repair04Solver | null = null
  private region: ExtractedRepairRegion | null = null
  private issues: DrcError[] | null = null
  private referenceErrors: DrcError[] | null = null
  private fixedViolations: Map<string, number> | null = null
  private attempted = new Set<string>()
  private regionCount = 0
  private acceptedRegionCount = 0
  private candidateAttempts = 0
  private pathSearchNodes = 0
  private pathSearchCalls = 0
  private attemptsSinceAcceptance = 0
  private nodesSinceAcceptance = 0
  private initialReferenceErrors: number | null = null
  private effectiveMaxTotalCandidateAttempts: number | null = null
  private readonly trackWork: boolean

  constructor(private readonly input: Pipeline9Repair04SolverParams) {
    super()
    for (const name of [
      "maxCandidateAttemptsSinceAcceptance",
      "maxInitialCandidateAttempts",
      "maxTotalCandidateAttempts",
      "fullEffortReferenceErrorCount",
      "maxPathSearchNodesSinceAcceptance",
      "maxPathSearchNodesPerRegion",
    ] as const) {
      const limit = input[name]
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
        throw new Error(`repair04: ${name} must be a positive safe integer`)
    }
    if (
      input.fullEffortReferenceErrorCount !== undefined &&
      input.maxTotalCandidateAttempts === undefined
    )
      throw new Error(
        "repair04: fullEffortReferenceErrorCount requires maxTotalCandidateAttempts",
      )
    this.trackWork =
      input.maxCandidateAttemptsSinceAcceptance !== undefined ||
      input.maxInitialCandidateAttempts !== undefined ||
      input.maxTotalCandidateAttempts !== undefined ||
      input.maxPathSearchNodesSinceAcceptance !== undefined ||
      input.maxPathSearchNodesPerRegion !== undefined
    this.routes = input.hdRoutes
    this.engine = new AutoroutingDrcEngine(input.srj as any, {
      // Local DRC uses declared SRJ net aliases. The topology connectivity map
      // can join distinct declared nets through geometric obstacle aliases.
      includeTraceViaOwnerMetadata: true,
    })
    this.MAX_ITERATIONS =
      (input.maxRegions ?? 32) *
        ((input.maxCandidatesPerRegion ?? 8000) * 2 + 6) +
      2
  }

  private evaluateReference(routes: HighDensityRoute[]): DrcError[] {
    const result = this.input.referenceDrcEvaluator({
      hdRoutes: routes,
      routes,
      traces: convertRepairRoutesToTraces(routes, this.input.srj.layerCount),
    })
    return Array.isArray(result) ? result : result.errors
  }

  private evaluate(routes: HighDensityRoute[]): DrcError[] {
    return this.engine.evaluate([
      ...(this.input.srj.traces ?? []).map((trace) =>
        normalizeRepairTrace(trace as any, this.input.srj.minTraceWidth),
      ),
      ...convertRepairRoutesToTraces(routes, this.input.srj.layerCount),
    ] as any).errorsWithCenters
  }

  private getCandidateAttemptLimit(): number | undefined {
    if (
      this.acceptedRegionCount === 0 &&
      this.input.maxInitialCandidateAttempts !== undefined
    )
      return this.input.maxInitialCandidateAttempts
    return this.input.maxCandidateAttemptsSinceAcceptance
  }

  private getTotalWorkStats(): {
    initialReferenceErrors?: number | null
    effectiveMaxTotalCandidateAttempts?: number | null
  } {
    if (this.input.maxTotalCandidateAttempts === undefined) return {}
    return {
      initialReferenceErrors: this.initialReferenceErrors,
      effectiveMaxTotalCandidateAttempts:
        this.effectiveMaxTotalCandidateAttempts,
    }
  }

  private recordCompletedWork(): void {
    if (!this.trackWork) return
    if (!this.localSolver) throw new Error("repair04: missing work source")
    const { candidateAttempts, pathSearchNodes, pathSearchCalls } =
      this.localSolver.stats
    for (const [name, count] of Object.entries({
      candidateAttempts,
      pathSearchNodes,
      pathSearchCalls,
    })) {
      if (!Number.isSafeInteger(count) || count < 0)
        throw new Error(`repair04: invalid completed child ${name}`)
    }
    this.candidateAttempts += candidateAttempts
    this.pathSearchNodes += pathSearchNodes
    this.pathSearchCalls += pathSearchCalls
    this.attemptsSinceAcceptance += candidateAttempts
    this.nodesSinceAcceptance += pathSearchNodes
  }

  private finishRepair(
    completionReason:
      | "clean"
      | "region-budget"
      | "unsuccessful-work-budget"
      | "total-work-budget"
      | "search-exhausted",
  ): void {
    this.stats = {
      ...this.stats,
      regions: this.regionCount,
      acceptedRegions: this.acceptedRegionCount,
      indexedErrors: this.issues?.length ?? null,
      referenceErrors: this.referenceErrors?.length ?? null,
      completionReason,
      ...this.getTotalWorkStats(),
      ...(this.trackWork
        ? {
            candidateAttempts: this.candidateAttempts,
            pathSearchNodes: this.pathSearchNodes,
            pathSearchCalls: this.pathSearchCalls,
            attemptsSinceAcceptance: this.attemptsSinceAcceptance,
            nodesSinceAcceptance: this.nodesSinceAcceptance,
          }
        : {}),
    }
    this.solved = true
  }

  override _step(): void {
    if (!this.issues) {
      this.issues = this.evaluate(this.routes)
      this.referenceErrors = this.evaluateReference(this.routes)
      if (this.input.maxTotalCandidateAttempts !== undefined) {
        this.initialReferenceErrors = this.referenceErrors.length
        const scale =
          this.input.fullEffortReferenceErrorCount === undefined
            ? 1
            : Math.min(
                1,
                this.input.fullEffortReferenceErrorCount /
                  Math.max(1, this.initialReferenceErrors),
              )
        this.effectiveMaxTotalCandidateAttempts = Math.max(
          1,
          Math.floor(this.input.maxTotalCandidateAttempts * scale),
        )
        this.stats = { ...this.stats, ...this.getTotalWorkStats() }
      }
      this.fixedViolations = new Map(
        getFixedObstacleViolations({
          srj: this.input.srj as any,
          routes: this.routes,
        }).map((violation) => [violation.key, violation.severity]),
      )
    }
    if (this.localSolver) {
      this.localSolver.step()
      if (this.localSolver.failed)
        throw new Error(`repair04 failed: ${this.localSolver.error}`)
      if (!this.localSolver.solved) return
      if (!this.region) throw new Error("repair04: completed region is missing")
      this.recordCompletedWork()
      const candidate = mergeRepairRegion({
        routes: this.routes,
        region: this.region,
        repairedRoutes: this.localSolver.getOutput(),
      }) as HighDensityRoute[]
      // Merge still validates the complete boundary contract. If it retained
      // every source route, all board-level checks have the same exact input.
      if (candidate.some((route, index) => route !== this.routes[index])) {
        const candidateIssues = this.evaluate(candidate)
        const fixedViolations = getFixedObstacleViolations({
          srj: this.input.srj as any,
          routes: candidate,
        })
        const preservesFixedObstacles = fixedViolations.every(
          ({ key, severity }) =>
            this.fixedViolations!.has(key) &&
            severity <= this.fixedViolations!.get(key)! + 1e-8,
        )
        const preservesViaPadClearance =
          getNewViaPadViolations({
            srj: this.input.srj as any,
            previousRoutes: this.routes,
            routes: candidate,
          }).length === 0
        if (
          preservesViaPadClearance &&
          preservesFixedObstacles &&
          candidateIssues.length <= this.issues.length
        ) {
          const candidateReferenceErrors = this.evaluateReference(candidate)
          if (
            candidateReferenceErrors.length <= this.referenceErrors!.length &&
            (candidateIssues.length < this.issues.length ||
              candidateReferenceErrors.length < this.referenceErrors!.length)
          ) {
            this.routes = candidate
            this.issues = candidateIssues
            this.referenceErrors = candidateReferenceErrors
            this.fixedViolations = new Map(
              fixedViolations.map((violation) => [
                violation.key,
                violation.severity,
              ]),
            )
            this.acceptedRegionCount++
            // Child-local improvements do not reset this ledger. Only the
            // proposal retained by every full-board acceptance guard does.
            this.attemptsSinceAcceptance = 0
            this.nodesSinceAcceptance = 0
          }
        }
      }
      this.localSolver = null
      this.region = null
      this.stats = {
        regions: this.regionCount,
        acceptedRegions: this.acceptedRegionCount,
        indexedErrors: this.issues.length,
        referenceErrors: this.referenceErrors!.length,
        ...this.getTotalWorkStats(),
        ...(this.trackWork
          ? {
              candidateAttempts: this.candidateAttempts,
              pathSearchNodes: this.pathSearchNodes,
              pathSearchCalls: this.pathSearchCalls,
              attemptsSinceAcceptance: this.attemptsSinceAcceptance,
              nodesSinceAcceptance: this.nodesSinceAcceptance,
            }
          : {}),
      }
    }
    if (this.referenceErrors!.length === 0) {
      this.finishRepair("clean")
      return
    }
    if (
      this.effectiveMaxTotalCandidateAttempts !== null &&
      this.candidateAttempts >= this.effectiveMaxTotalCandidateAttempts
    ) {
      this.finishRepair("total-work-budget")
      return
    }
    if (this.regionCount >= (this.input.maxRegions ?? 32)) {
      this.finishRepair("region-budget")
      return
    }
    const candidateAttemptLimit = this.getCandidateAttemptLimit()
    if (
      (candidateAttemptLimit !== undefined &&
        this.attemptsSinceAcceptance >= candidateAttemptLimit) ||
      (this.input.maxPathSearchNodesSinceAcceptance !== undefined &&
        this.nodesSinceAcceptance >=
          this.input.maxPathSearchNodesSinceAcceptance)
    ) {
      this.finishRepair("unsuccessful-work-budget")
      return
    }
    // Escalate one issue's context before moving on; a long issue list must
    // not consume the entire region budget before any larger bounds are tried.
    for (const error of [...this.referenceErrors!, ...this.issues]) {
      for (const allowLayerChanges of this.input.allowLayerChanges === true
        ? [false, true]
        : [false]) {
        for (const size of [10, 16, 24]) {
          const selectedVias =
            this.input.allowExistingViaRelocation === false || allowLayerChanges
              ? []
              : this.referenceErrors!.flatMap(
                  (referenceError): ExistingViaRepairTarget[] =>
                    (referenceError.existingViaRepairTargets ??
                      []) as ExistingViaRepairTarget[],
                )
          const errorViaTargets = (error.existingViaRepairTargets ??
            []) as ExistingViaRepairTarget[]
          const center = errorViaTargets[0] ?? error.center ?? error.pcb_center
          if (
            !center ||
            typeof center !== "object" ||
            !("x" in center) ||
            !("y" in center)
          )
            continue
          const { x, y } = center as { x: number; y: number }
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue
          const key = `${Math.round(x * 2)},${Math.round(y * 2)},${size},${allowLayerChanges}`
          if (this.attempted.has(key)) continue
          this.attempted.add(key)
          // The existing-via pass cannot move anything without a reference
          // target. Keep the attempted key but avoid constructing a crop that
          // would necessarily be discarded by the movable-via check below.
          if (
            this.input.allowLayerChanges === true &&
            !allowLayerChanges &&
            selectedVias.length === 0
          )
            continue
          const region = extractRepairRegion({
            srj: this.input.srj as any,
            routes: this.routes,
            bounds: {
              minX: x - size / 2,
              minY: y - size / 2,
              maxX: x + size / 2,
              maxY: y + size / 2,
            },
          })
          const movableVias = region.routes.flatMap(
            (route, routeIndex): { routeIndex: number; viaIndex: number }[] => {
              const sourceRouteIndex =
                region.routeMappings[routeIndex]!.sourceRouteIndex
              return getRepairViaGeometry(route, region.srj.layerCount).flatMap(
                (via, viaIndex): { routeIndex: number; viaIndex: number }[] => {
                  const selected = selectedVias.some((target): boolean => {
                    if (target.routeIndex !== sourceRouteIndex) return false
                    const sourceVia = getRepairViaGeometry(
                      this.routes[sourceRouteIndex]!,
                      region.srj.layerCount,
                    )[target.viaIndex]
                    return (
                      sourceVia !== undefined &&
                      sourceVia.identity === via.identity &&
                      JSON.stringify(sourceVia.layerSequence) ===
                        JSON.stringify(via.layerSequence)
                    )
                  })
                  const locked = via.pointIndices.some(
                    (pointIndex): boolean =>
                      region.lockedPointIndices[routeIndex]![pointIndex]! ||
                      pointIndex === 0 ||
                      pointIndex === route.route.length - 1 ||
                      Boolean(
                        route.route[pointIndex]!.pcb_port_id ||
                          route.route[pointIndex]!.insideJumperPad ||
                          route.route[pointIndex]!.toNextSegmentType,
                      ),
                  )
                  return selected && !locked ? [{ routeIndex, viaIndex }] : []
                },
              )
            },
          )
          if (
            this.input.allowLayerChanges === true &&
            !allowLayerChanges &&
            movableVias.length === 0
          )
            continue
          this.region = region
          this.localSolver = new Repair04Solver({
            srj: region.srj,
            routes: region.routes,
            bounds: region.bounds,
            boundaryMargin: region.boundaryMargin,
            lockedPointIndices: region.lockedPointIndices,
            maxCandidates:
              this.input.allowLayerChanges === true && !allowLayerChanges
                ? Math.min(512, this.input.maxCandidatesPerRegion ?? 8000)
                : (this.input.maxCandidatesPerRegion ?? 8000),
            ...(this.trackWork
              ? {
                  maxCandidateAttempts: Math.min(
                    candidateAttemptLimit === undefined
                      ? Number.MAX_SAFE_INTEGER
                      : candidateAttemptLimit - this.attemptsSinceAcceptance,
                    this.effectiveMaxTotalCandidateAttempts === null
                      ? Number.MAX_SAFE_INTEGER
                      : this.effectiveMaxTotalCandidateAttempts -
                          this.candidateAttempts,
                  ),
                  maxPathSearchNodes: Math.min(
                    this.input.maxPathSearchNodesPerRegion ??
                      Number.MAX_SAFE_INTEGER,
                    this.input.maxPathSearchNodesSinceAcceptance === undefined
                      ? Number.MAX_SAFE_INTEGER
                      : this.input.maxPathSearchNodesSinceAcceptance -
                          this.nodesSinceAcceptance,
                  ),
                }
              : {}),
            allowLayerChanges,
            traceOnlyFirst: this.input.traceOnlyFirst,
            movableVias,
          })
          this.regionCount++
          return
        }
      }
    }
    this.finishRepair("search-exhausted")
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved || this.failed)
      throw new Error("repair04: output requested before completed stage")
    return this.routes
  }

  override getConstructorParams(): [Pipeline9Repair04SolverParams] {
    return [this.input]
  }

  override visualize(): GraphicsObject {
    return this.localSolver?.visualize() ?? { lines: [], points: [], rects: [] }
  }
}
