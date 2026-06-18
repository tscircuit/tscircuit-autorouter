import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { BaseSolver as PipelineBaseSolver } from "@tscircuit/solver-utils"
import {
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  TinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"
import {
  applyMetadataPortPenalties,
  applyPortMetadataPenalties,
  applyTerminalRegionNetIds,
} from "./tinyHypergraphMetadata"
import { getTinyHyperGraphPipelineMaxIterations } from "./tinyHypergraphOptions"
import type {
  LoadedTinyGraph,
  TinyHyperGraphSectionPipelineInput,
} from "./types"

export class TinyHyperGraphSectionPipelineWithTerminalNetIds extends TinyHyperGraphSectionPipelineSolver {
  private configuredSolvers = new WeakSet<PipelineBaseSolver>()
  duplicatePortPenaltyCount = 0
  metadataPortPenaltyCount = 0
  crampedPortPenaltyCount = 0

  constructor(inputProblem: TinyHyperGraphSectionPipelineInput) {
    super(inputProblem)
    this.MAX_ITERATIONS = getTinyHyperGraphPipelineMaxIterations(inputProblem)
  }

  override loadHyperGraph(serializedHyperGraph: SerializedHyperGraph) {
    const loaded = super.loadHyperGraph(serializedHyperGraph)
    const metadataPortPenaltyCount = applyMetadataPortPenalties(loaded)
    const { duplicatePortPenaltyCount, crampedPortPenaltyCount } =
      applyPortMetadataPenalties(loaded)
    applyTerminalRegionNetIds(loaded)
    this.metadataPortPenaltyCount = Math.max(
      this.metadataPortPenaltyCount,
      metadataPortPenaltyCount,
    )
    this.duplicatePortPenaltyCount = Math.max(
      this.duplicatePortPenaltyCount,
      duplicatePortPenaltyCount,
    )
    this.crampedPortPenaltyCount = Math.max(
      this.crampedPortPenaltyCount,
      crampedPortPenaltyCount,
    )
    return loaded
  }

  override _step(): void {
    try {
      super._step()
    } catch (error) {
      if (this.tryAcceptSolveGraphWithoutSerializedOutput(error)) {
        return
      }
      if (this.trySkipOptimizeSection(error)) {
        return
      }
      throw error
    }
    this.configureSolver(this.activeSubSolver)
  }

  override getInitialVisualizationSolver(): TinyHyperGraphSolver {
    const solver = super.getInitialVisualizationSolver()
    this.configureSolver(solver)
    return solver
  }

  getSolvedTinySolver(): TinyHyperGraphSolver {
    const optimizeSectionSolver =
      this.getSolver<TinyHyperGraphSectionSolver>("optimizeSection")

    if (optimizeSectionSolver?.solved && !optimizeSectionSolver.failed) {
      return optimizeSectionSolver.getSolvedSolver()
    }

    const solveGraphSolver = this.getSolver<TinyHyperGraphSolver>("solveGraph")
    if (solveGraphSolver?.solved && !solveGraphSolver.failed) {
      return solveGraphSolver
    }

    throw new Error(
      "TinyHyperGraph section pipeline does not have a solved graph",
    )
  }

  private configureSolver(solver?: PipelineBaseSolver | null) {
    if (!solver || this.configuredSolvers.has(solver)) {
      return
    }

    if (
      solver instanceof TinyHyperGraphSectionSolver ||
      solver instanceof TinyHyperGraphSolver
    ) {
      const loadedSolver = solver as LoadedTinyGraph
      applyMetadataPortPenalties(loadedSolver)
      applyTerminalRegionNetIds(loadedSolver)
    }

    this.configuredSolvers.add(solver)
  }

  private trySkipOptimizeSection(error: unknown): boolean {
    if (this.getCurrentStageName() !== "optimizeSection") {
      return false
    }

    const solveGraphOutput =
      this.getStageOutput<SerializedHyperGraph>("solveGraph")

    if (!solveGraphOutput) {
      return false
    }

    this.pipelineOutputs.optimizeSection = solveGraphOutput
    this.finishWithExistingSolverState({
      sectionOptimizationSkipped: true,
      sectionOptimizationError:
        error instanceof Error ? error.message : String(error),
    })
    return true
  }

  private tryAcceptSolveGraphWithoutSerializedOutput(error: unknown): boolean {
    if (this.getCurrentStageName() !== "solveGraph") {
      return false
    }

    const solveGraphSolver = this.getSolver<TinyHyperGraphSolver>("solveGraph")
    if (!solveGraphSolver?.solved || solveGraphSolver.failed) {
      return false
    }

    this.finishWithExistingSolverState({
      solveGraphSerializationSkipped: true,
      sectionOptimizationSkipped: true,
      sectionOptimizationError:
        error instanceof Error ? error.message : String(error),
    })
    return true
  }

  private finishWithExistingSolverState(
    extraStats: Record<string, unknown>,
  ): void {
    this.currentPipelineStageIndex = this.pipelineDef.length
    this.activeSubSolver = null
    this.solved = true
    this.failed = false
    this.error = null
    this.stats = {
      ...this.stats,
      ...extraStats,
    }
  }
}
