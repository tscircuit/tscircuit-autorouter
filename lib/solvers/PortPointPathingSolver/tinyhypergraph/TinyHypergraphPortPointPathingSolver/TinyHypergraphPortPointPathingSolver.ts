import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  BasePipelineSolver,
  definePipelineStep,
} from "@tscircuit/solver-utils"
import type { PipelineStep } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import { buildSerializedTinyGraph } from "./buildSerializedTinyGraph"
import { DuplicateCongestedPortPrepassSolver } from "./DuplicateCongestedPortPrepassSolver"
import { TinyHypergraphSolveStage } from "./TinyHypergraphSolveStage"
import {
  DUPLICATE_PORT_TRAVERSAL_PENALTY,
  type CapacityMeshNodeId,
  type DuplicateCongestedPortPrepassOutput,
  type HgPortPointPathingSolverParams,
  type InputNodeWithPortPoints,
  type TinyHypergraphPortPointPathingOutput,
  type TinyHypergraphPortPointPathingStats,
} from "./types"

export class TinyHypergraphPortPointPathingSolver extends BasePipelineSolver<HgPortPointPathingSolverParams> {
  duplicateCongestedPortPrepass?: DuplicateCongestedPortPrepassSolver
  tinyHypergraphSolve?: TinyHypergraphSolveStage

  private readonly originalRegionById: Map<
    CapacityMeshNodeId,
    HgPortPointPathingSolverParams["graph"]["regions"][number]
  >
  private readonly serializedGraph: SerializedHyperGraph

  pipelineDef: PipelineStep<any>[] = [
    definePipelineStep(
      "duplicateCongestedPortPrepass",
      DuplicateCongestedPortPrepassSolver,
      (instance: TinyHypergraphPortPointPathingSolver) => [
        {
          serializedGraph: instance.serializedGraph,
          effort: instance.inputProblem.effort,
          minViaPadDiameter: instance.inputProblem.minViaPadDiameter,
          connectionCount: instance.inputProblem.connections.length,
        },
      ],
    ),
    definePipelineStep(
      "tinyHypergraphSolve",
      TinyHypergraphSolveStage,
      (instance: TinyHypergraphPortPointPathingSolver) => [
        {
          pathingProblem: instance.inputProblem,
          serializedGraph: instance.serializedGraph,
          graphForTiny: instance.getGraphForTiny(),
        },
      ],
    ),
  ]

  constructor(public readonly inputProblem: HgPortPointPathingSolverParams) {
    super(inputProblem)
    this.MAX_ITERATIONS = Number.POSITIVE_INFINITY
    this.serializedGraph = buildSerializedTinyGraph(inputProblem)
    this.originalRegionById = new Map(
      inputProblem.graph.regions.map((region) => [region.regionId, region]),
    )
  }

  override _step(): void {
    super._step()
    this.syncStats()
  }

  override getConstructorParams(): readonly [HgPortPointPathingSolverParams] {
    return [this.inputProblem] as const
  }

  override getOutput(): TinyHypergraphPortPointPathingOutput {
    const output =
      this.getStageOutput<TinyHypergraphPortPointPathingOutput>(
        "tinyHypergraphSolve",
      )

    if (!output) {
      throw new Error("TinyHypergraphPortPointPathingSolver has not solved yet")
    }

    return output
  }

  computeNodePf(node: InputNodeWithPortPoints): number | null {
    const solvedNode = this.getOutput().nodesWithPortPoints.find(
      (candidate) => candidate.capacityMeshNodeId === node.capacityMeshNodeId,
    )
    const originalRegion = this.originalRegionById.get(node.capacityMeshNodeId)

    if (!solvedNode || !originalRegion) {
      return null
    }

    const crossings = getIntraNodeCrossingsUsingCircle(solvedNode)

    return calculateNodeProbabilityOfFailure(
      originalRegion.d,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )
  }

  override preview(): GraphicsObject {
    return this.visualize()
  }

  private getGraphForTiny(): SerializedHyperGraph {
    return (
      this.getStageOutput<DuplicateCongestedPortPrepassOutput>(
        "duplicateCongestedPortPrepass",
      )?.graphForTiny ?? this.serializedGraph
    )
  }

  private syncStats() {
    const duplicateOutput =
      this.getStageOutput<DuplicateCongestedPortPrepassOutput>(
        "duplicateCongestedPortPrepass",
      ) ?? this.duplicateCongestedPortPrepass?.getOutput()
    const tinyStats = this.tinyHypergraphSolve?.stats ?? {}

    this.stats = {
      duplicateCongestedPortSourceCount:
        duplicateOutput?.duplicateCongestedPortReport?.duplicatedPorts.length ??
        0,
      duplicateCongestedPortCount: duplicateOutput?.duplicatedPortCount ?? 0,
      duplicateCongestedPortFallbackToOriginal: Boolean(
        duplicateOutput?.duplicateCongestedPortError,
      ),
      duplicateCongestedPortPenalty:
        (duplicateOutput?.duplicatedPortCount ?? 0) > 0
          ? DUPLICATE_PORT_TRAVERSAL_PENALTY
          : 0,
      duplicateCongestedPortError:
        duplicateOutput?.duplicateCongestedPortError,
      duplicateCongestedPortProgress:
        this.duplicateCongestedPortPrepass?.progress ?? 0,
      ...tinyStats,
      currentStage: this.solved ? "solved" : this.getCurrentStageName(),
      stageStats: this.getStageStats(),
    } satisfies TinyHypergraphPortPointPathingStats
  }
}
