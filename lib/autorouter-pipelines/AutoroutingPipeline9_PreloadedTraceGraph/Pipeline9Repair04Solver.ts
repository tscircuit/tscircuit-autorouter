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
  enabled: boolean
  maxRegions?: number
  maxCandidatesPerRegion?: number
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

  constructor(private readonly input: Pipeline9Repair04SolverParams) {
    super()
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

  override _step(): void {
    if (!this.input.enabled) {
      this.solved = true
      return
    }
    if (!this.issues) {
      this.issues = this.evaluate(this.routes)
      this.referenceErrors = this.evaluateReference(this.routes)
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
      const candidate = mergeRepairRegion({
        routes: this.routes,
        region: this.region,
        repairedRoutes: this.localSolver.getOutput(),
      }) as HighDensityRoute[]
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
        }
      }
      this.localSolver = null
      this.region = null
      this.stats = {
        regions: this.regionCount,
        acceptedRegions: this.acceptedRegionCount,
        indexedErrors: this.issues.length,
        referenceErrors: this.referenceErrors!.length,
      }
    }
    if (
      this.referenceErrors!.length === 0 ||
      this.regionCount >= (this.input.maxRegions ?? 32)
    ) {
      this.solved = true
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
            allowLayerChanges,
            traceOnlyFirst: this.input.traceOnlyFirst,
            movableVias,
          })
          this.regionCount++
          return
        }
      }
    }
    this.solved = true
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
