import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import {
  type MovablePreloadedSection,
  Pipeline9JointDrcRepairSolver,
  type Pipeline9JointDrcRepairSolverParams,
  type Pipeline9PreloadedTraceReconstruction,
} from "./Pipeline9JointDrcRepairSolver"
import { isPipeline9JointDrcOutputNoWorse } from "./isPipeline9JointDrcOutputNoWorse"
import { preparePipeline9DrcRoutedTracesWithMetadata } from "./preparePipeline9DrcRoutedTraces"

type InheritedMovablePreloadedSection = MovablePreloadedSection & {
  anchorStart: HighDensityRoute["route"][number]
  anchorEnd: HighDensityRoute["route"][number]
}

/**
 * Repairs inherited ordinary copper only after the existing joint repair has
 * finished. Its full published board is the incumbent, never the earlier
 * global-repair output. Native Repair03 and the original joint policy remain
 * unchanged; this layer specializes ownership and publication only.
 */
export class Pipeline9InheritedDrcRepairSolver extends Pipeline9JointDrcRepairSolver {
  private readonly incumbentParams: Pipeline9JointDrcRepairSolverParams
  private inheritedOutputAccepted = false

  constructor(params: Pipeline9JointDrcRepairSolverParams) {
    // Native search may mutate its working geometry. Keep the previously
    // accepted stage's complete board separate from every speculative input.
    const searchConnMap = new ConnectivityMap(
      structuredClone(params.connMap.netMap),
    )
    // Merged net keys may share one member array. Reconstructing only netMap
    // changes its primary ID according to key order; retain both maps exactly.
    searchConnMap.idToNetMap = { ...params.connMap.idToNetMap }
    super({
      ...params,
      connMap: searchConnMap,
      srj: structuredClone(params.srj),
      srjWithPointPairs: structuredClone(params.srjWithPointPairs),
      originalSrj: structuredClone(params.originalSrj),
      newConnections: structuredClone(params.newConnections),
      newHdRoutes: structuredClone(params.newHdRoutes),
      updatedPreloadedTraces: structuredClone(params.updatedPreloadedTraces),
      mutatedPreloadedTraceIds: new Set(params.mutatedPreloadedTraceIds),
      obstacles: structuredClone(params.obstacles),
      colorMap: { ...params.colorMap },
    })
    this.incumbentParams = params
    this.stats = {
      ...this.stats,
      jointOutputValidationAttempted: false,
      jointOutputAccepted: false,
      jointOutputRejectedForSectionAnchor: false,
      jointOutputRejectedForTerminalMetadata: false,
      jointOutputRejectedForDrcRegression: false,
      publishedJointDrcIssueCount:
        this.publicationContext.currentDrcResult.errors.length,
      inheritedRepairSkippedForEmptyOwnership:
        this.movablePreloadedSections.length === 0,
    }
    // This layer owns ordinary preloaded sections, not a second search over
    // purely new HD routes. Empty ownership is normal completed work.
    if (this.movablePreloadedSections.length === 0) {
      this.solved = true
      this.activeSubSolver = null
    }
  }

  override getSolverName(): string {
    return "Pipeline9InheritedDrcRepairSolver"
  }

  override getConstructorParams(): [Pipeline9JointDrcRepairSolverParams] {
    return [this.incumbentParams]
  }

  protected override selectDrcErrors<
    TError extends Record<string, unknown>,
  >(input: {
    errors: TError[]
    baselineErrors: Array<Record<string, unknown>>
    originalTraceIdByPreparedTraceId?: ReadonlyMap<string, string>
  }): TError[] {
    // Provenance does not exempt an ordinary wire from this layer's objective.
    // Keep the complete official set, including inherited same-ID worsening.
    return input.errors
  }

  protected override prepareMovablePreloadedSection(
    section: MovablePreloadedSection,
  ): InheritedMovablePreloadedSection {
    const route = section.hdRoute.route.map(
      (point): HighDensityRoute["route"][number] => {
        const taggedWire = section.originalTrace.route.find(
          (primitive): boolean =>
            primitive.route_type === "wire" &&
            primitive.x === point.x &&
            primitive.y === point.y &&
            primitive.layer ===
              mapZToLayerName(point.z, this.params.layerCount) &&
            (primitive.start_pcb_port_id !== undefined ||
              primitive.end_pcb_port_id !== undefined),
        )
        return taggedWire?.route_type === "wire"
          ? {
              ...point,
              pcb_port_id:
                taggedWire.start_pcb_port_id ?? taggedWire.end_pcb_port_id,
            }
          : point
      },
    )
    if (route.length < 2) {
      throw new Error("Pipeline9 inherited repair requires two section anchors")
    }
    return {
      ...section,
      hdRoute: { ...section.hdRoute, route },
      anchorStart: { ...route[0]! },
      anchorEnd: { ...route.at(-1)! },
    }
  }

  protected override rebuildPreloadedTrace(
    input: Pipeline9PreloadedTraceReconstruction,
  ): SimplifiedPcbTrace {
    const rebuilt = super.rebuildPreloadedTrace(input)
    return {
      ...rebuilt,
      route: rebuilt.route.map((point): SimplifiedPcbTrace["route"][number] => {
        const originalPoint =
          point.route_type === "wire"
            ? input.originalTrace.route.find(
                (primitive): boolean =>
                  primitive.route_type === "wire" &&
                  primitive.x === point.x &&
                  primitive.y === point.y &&
                  primitive.layer === point.layer &&
                  (primitive.start_pcb_port_id !== undefined ||
                    primitive.end_pcb_port_id !== undefined),
              )
            : undefined
        if (
          point.route_type !== "wire" ||
          originalPoint?.route_type !== "wire"
        ) {
          return point
        }
        return {
          ...point,
          ...(originalPoint.start_pcb_port_id === undefined
            ? {}
            : { start_pcb_port_id: originalPoint.start_pcb_port_id }),
          ...(originalPoint.end_pcb_port_id === undefined
            ? {}
            : { end_pcb_port_id: originalPoint.end_pcb_port_id }),
        }
      }),
    }
  }

  private validateInheritedOutput(routes: HighDensityRoute[]): boolean {
    const params = this.params
    const { currentDrcResult, convertNewRoutes, traceClearance } =
      this.publicationContext
    this.stats.jointOutputValidationAttempted = true
    this.stats.jointOutputRejectedForSectionAnchor = false
    this.stats.jointOutputRejectedForTerminalMetadata = false
    this.stats.jointOutputRejectedForDrcRegression = false
    this.stats.publishedJointDrcIssueCount = currentDrcResult.errors.length
    // Synthetic section boundaries anchor on real terminals or protected
    // through-obstacle spans. A section must not detach from either end.
    const inheritedSections = this
      .movablePreloadedSections as InheritedMovablePreloadedSection[]
    for (const section of inheritedSections) {
      const candidateSections = routes.filter(
        (route) => route.connectionName === section.syntheticConnectionName,
      )
      if (candidateSections.length !== 1) {
        throw new Error(
          `Pipeline9 joint output requires one section "${section.syntheticConnectionName}"`,
        )
      }
      const candidate = candidateSections[0]!
      const start = candidate.route[0]
      const end = candidate.route.at(-1)
      const originalStart = section.anchorStart
      const originalEnd = section.anchorEnd
      if (
        !start ||
        !end ||
        start.x !== originalStart.x ||
        start.y !== originalStart.y ||
        start.z !== originalStart.z ||
        end.x !== originalEnd.x ||
        end.y !== originalEnd.y ||
        end.z !== originalEnd.z
      ) {
        this.stats.jointOutputRejectedForSectionAnchor = true
        return false
      }
    }
    const changedPreloadedTraceIds = new Set([
      ...params.mutatedPreloadedTraceIds,
      ...this.movablePreloadedSections.map(
        (section) => section.originalTrace.pcb_trace_id,
      ),
    ])
    // Check the exact public reconstruction, not the separate synthetic
    // sections used for search. Reattach every protected primitive first.
    const updatedPreloadedTraces = this.rebuildUpdatedPreloadedTraces(routes)
    for (const [
      index,
      originalTrace,
    ] of params.updatedPreloadedTraces.entries()) {
      const updatedTrace = updatedPreloadedTraces[index]!
      for (const primitive of originalTrace.route) {
        if (
          primitive.route_type !== "wire" ||
          (primitive.start_pcb_port_id === undefined &&
            primitive.end_pcb_port_id === undefined)
        ) {
          continue
        }
        const terminalPreserved = updatedTrace.route.some(
          (point): boolean =>
            point.route_type === "wire" &&
            point.x === primitive.x &&
            point.y === primitive.y &&
            point.layer === primitive.layer &&
            point.start_pcb_port_id === primitive.start_pcb_port_id &&
            point.end_pcb_port_id === primitive.end_pcb_port_id,
        )
        if (!terminalPreserved) {
          this.stats.jointOutputRejectedForTerminalMetadata = true
          return false
        }
      }
    }
    const preparedOutput = preparePipeline9DrcRoutedTracesWithMetadata({
      originalPreloadedTraces: params.originalSrj.traces ?? [],
      mutatedPreloadedTraces: updatedPreloadedTraces.filter((trace) =>
        changedPreloadedTraceIds.has(trace.pcb_trace_id),
      ),
      newTraces: convertNewRoutes(
        routes.filter(
          (route) => !this.syntheticConnectionNames.has(route.connectionName),
        ),
      ),
    })
    const candidateDrc = evaluateRelaxedDrc({
      inputSrj: params.originalSrj,
      srjWithPointPairs: params.srjWithPointPairs,
      routedTraces: preparedOutput.routedTraces,
      drcOptions: { traceClearance },
    })
    this.stats.jointOutputCandidateDrcIssueCount = candidateDrc.errors.length
    const noWorse = isPipeline9JointDrcOutputNoWorse({
      candidate: {
        errors: candidateDrc.errors.map(
          (error): Record<string, unknown> => ({ ...error }),
        ),
        circuitJson: candidateDrc.circuitJson,
      },
      current: {
        errors: currentDrcResult.errors.map(
          (error): Record<string, unknown> => ({ ...error }),
        ),
        circuitJson: currentDrcResult.circuitJson,
      },
    })
    this.stats.jointOutputRejectedForDrcRegression = !noWorse
    this.stats.publishedJointDrcIssueCount = noWorse
      ? candidateDrc.errors.length
      : currentDrcResult.errors.length
    return noWorse
  }

  protected override publishValidatedOutput(routes: HighDensityRoute[]): void {
    this.inheritedOutputAccepted = this.validateInheritedOutput(routes)
    this.stats.jointOutputAccepted = this.inheritedOutputAccepted
    // Rejected optimization proposals preserve the complete incoming board.
    // Solver failures still propagate through the inherited incremental loop.
    super.publishValidatedOutput(
      this.inheritedOutputAccepted ? routes : this.inputNewHdRoutes,
    )
  }

  override getOutput(): HighDensityRoute[] {
    if (!this.inheritedOutputAccepted) {
      return this.incumbentParams.newHdRoutes
    }
    return super.getOutput()
  }

  override getUpdatedPreloadedTraces(): SimplifiedPcbTrace[] {
    if (!this.inheritedOutputAccepted) {
      return this.incumbentParams.updatedPreloadedTraces
    }
    return this.rebuildUpdatedPreloadedTraces(this.getCombinedOutput())
  }

  override getMutatedPreloadedTraces(): SimplifiedPcbTrace[] {
    const mutatedTraceIds = new Set([
      ...this.incumbentParams.mutatedPreloadedTraceIds,
      ...(this.inheritedOutputAccepted
        ? this.movablePreloadedSections.map(
            (section) => section.originalTrace.pcb_trace_id,
          )
        : []),
    ])
    return this.getUpdatedPreloadedTraces().filter((trace) =>
      mutatedTraceIds.has(trace.pcb_trace_id),
    )
  }
}
