import { BaseSolver as PipelineBaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  TinyHyperGraphSectionSolver,
  TinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"
import { buildInputNodesWithPortPoints } from "./buildInputNodesWithPortPoints"
import {
  getRouteConnectionName,
  getRouteRootConnectionName,
} from "./routeMetadata"
import {
  getTinyHyperGraphPipelineInput,
  getTinyHyperGraphPipelineMaxIterations,
} from "./tinyHypergraphOptions"
import { TinyHyperGraphSectionPipelineWithTerminalNetIds } from "./TinyHyperGraphSectionPipelineWithTerminalNetIds"
import { getPortPointLinkIds } from "./tinyHypergraphMetadata"
import {
  CRAMPED_PORT_TRAVERSAL_PENALTY,
  type CapacityMeshNodeId,
  type HgPortPointPathingSolverParams,
  type InputNodeWithPortPoints,
  type NodeWithPortPoints,
  type PortPoint,
  type RouteMetadata,
  type TinyHypergraphPortPointPathingOutput,
  type TinyHypergraphSolveStageInput,
} from "./types"

export class TinyHypergraphSolveStage extends PipelineBaseSolver {
  private readonly tinyPipelineSolver: TinyHyperGraphSectionPipelineWithTerminalNetIds
  private readonly originalRegionById: Map<
    CapacityMeshNodeId,
    HgPortPointPathingSolverParams["graph"]["regions"][number]
  >
  private readonly originalRegionIds: Set<CapacityMeshNodeId>
  private readonly inputNodeWithPortPoints: InputNodeWithPortPoints[]

  constructor(private readonly input: TinyHypergraphSolveStageInput) {
    super()
    const tinyPipelineInput = getTinyHyperGraphPipelineInput(
      {
        ...input.graphForTiny,
        solvedRoutes: input.serializedGraph.solvedRoutes,
      },
      input.pathingProblem.effort,
      input.pathingProblem.minViaPadDiameter,
    )
    this.tinyPipelineSolver =
      new TinyHyperGraphSectionPipelineWithTerminalNetIds(tinyPipelineInput)
    this.MAX_ITERATIONS = getTinyHyperGraphPipelineMaxIterations(tinyPipelineInput)
    this.originalRegionById = new Map(
      input.pathingProblem.graph.regions.map((region) => [region.regionId, region]),
    )
    this.originalRegionIds = new Set(this.originalRegionById.keys())
    this.inputNodeWithPortPoints = buildInputNodesWithPortPoints(
      input.pathingProblem,
      input.graphForTiny,
    )
    this.activeSubSolver = this.tinyPipelineSolver.activeSubSolver ?? null
  }

  override _step(): void {
    this.tinyPipelineSolver.step()

    const optimizeSectionSolver =
      this.tinyPipelineSolver.getSolver<TinyHyperGraphSectionSolver>(
        "optimizeSection",
      )
    const currentTinySolver = this.getCurrentTinySolver()

    this.solved = this.tinyPipelineSolver.solved
    this.failed = this.tinyPipelineSolver.failed
    this.error = this.tinyPipelineSolver.error ?? null
    this.progress = this.tinyPipelineSolver.progress
    this.stats = {
      duplicateCongestedPortPenaltyCount:
        this.tinyPipelineSolver.duplicatePortPenaltyCount,
      metadataPortPenaltyCount:
        this.tinyPipelineSolver.metadataPortPenaltyCount,
      crampedPortPenalty: CRAMPED_PORT_TRAVERSAL_PENALTY,
      crampedPortPenaltyCount: this.tinyPipelineSolver.crampedPortPenaltyCount,
      ...(this.tinyPipelineSolver.stats ?? {}),
      ...(currentTinySolver?.stats ?? {}),
      ...(optimizeSectionSolver?.stats ?? {}),
      currentStage: this.tinyPipelineSolver.getCurrentStageName(),
      stageStats: this.tinyPipelineSolver.getStageStats(),
    }
    this.activeSubSolver = this.tinyPipelineSolver.activeSubSolver ?? null
  }

  getSolvedTinySolver(): TinyHyperGraphSolver {
    return this.tinyPipelineSolver.getSolvedTinySolver()
  }

  override getOutput(): TinyHypergraphPortPointPathingOutput {
    const solvedTinySolver = this.getSolvedTinySolver()
    const nodesWithPortPoints: NodeWithPortPoints[] = []
    const regionSegments = solvedTinySolver.state.regionSegments
    const regionMetadata = solvedTinySolver.topology.regionMetadata ?? []

    for (let regionId = 0; regionId < regionSegments.length; regionId++) {
      const originalRegionId = regionMetadata[regionId]?.capacityMeshNodeId
      if (!originalRegionId || !this.originalRegionIds.has(originalRegionId)) {
        continue
      }

      const originalRegion = this.originalRegionById.get(originalRegionId)
      if (!originalRegion) continue

      const portPointsInPairs = regionSegments[regionId].map(
        ([routeId, fromPortId, toPortId]) => {
          const startPoint = this.createAssignedPortPoint(
            solvedTinySolver,
            routeId,
            fromPortId,
          )
          const endPoint = this.createAssignedPortPoint(
            solvedTinySolver,
            routeId,
            toPortId,
          )
          if (startPoint.portPointId && endPoint.portPointId) {
            startPoint.nextPortPointId = endPoint.portPointId
            endPoint.prevPortPointId = startPoint.portPointId
          }
          return [startPoint, endPoint] as [PortPoint, PortPoint]
        },
      )
      const portPoints = portPointsInPairs.flat()

      if (portPoints.length === 0) {
        continue
      }

      nodesWithPortPoints.push({
        capacityMeshNodeId: originalRegion.d.capacityMeshNodeId,
        center: originalRegion.d.center,
        width: originalRegion.d.width,
        height: originalRegion.d.height,
        portPoints,
        portPointsInPairs,
        availableZ: originalRegion.d.availableZ,
      })
    }

    return {
      nodesWithPortPoints,
      inputNodeWithPortPoints: this.inputNodeWithPortPoints,
    }
  }

  override getConstructorParams(): readonly [TinyHypergraphSolveStageInput] {
    return [this.input] as const
  }

  override visualize(): GraphicsObject {
    return this.tinyPipelineSolver.visualize()
  }

  private getCurrentTinySolver(): TinyHyperGraphSolver | undefined {
    const optimizeSectionSolver =
      this.tinyPipelineSolver.getSolver<TinyHyperGraphSectionSolver>(
        "optimizeSection",
      )

    if (optimizeSectionSolver?.solved && !optimizeSectionSolver.failed) {
      return optimizeSectionSolver.getSolvedSolver()
    }

    return this.tinyPipelineSolver.getSolver<TinyHyperGraphSolver>("solveGraph")
  }

  private getRouteMetadata(
    solvedTinySolver: TinyHyperGraphSolver,
    routeId: number,
  ): RouteMetadata | undefined {
    return solvedTinySolver.problem.routeMetadata?.[routeId] as
      | RouteMetadata
      | undefined
  }

  private createAssignedPortPoint(
    solvedTinySolver: TinyHyperGraphSolver,
    routeId: number,
    portId: number,
  ): PortPoint {
    const routeMetadata = this.getRouteMetadata(solvedTinySolver, routeId)
    const connectionName = routeMetadata
      ? getRouteConnectionName(routeMetadata)
      : `route-${routeId}`
    const rootConnectionName = routeMetadata
      ? getRouteRootConnectionName(routeMetadata)
      : undefined
    const portMetadata = solvedTinySolver.topology.portMetadata?.[portId]
    const { prevPortPointId, nextPortPointId } = getPortPointLinkIds(
      portMetadata ?? {},
    )

    return {
      portPointId: String(
        portMetadata?.serializedPortId ??
          portMetadata?.portId ??
          `tiny-port-${portId}`,
      ),
      x: solvedTinySolver.topology.portX[portId],
      y: solvedTinySolver.topology.portY[portId],
      z: solvedTinySolver.topology.portZ[portId],
      connectionName,
      rootConnectionName,
      prevPortPointId,
      nextPortPointId,
    }
  }
}
