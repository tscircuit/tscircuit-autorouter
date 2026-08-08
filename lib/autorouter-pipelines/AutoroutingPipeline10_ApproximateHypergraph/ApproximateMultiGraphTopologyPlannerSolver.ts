import { BasePipelineSolver, definePipelineStep } from "@tscircuit/solver-utils"
import type { BaseSolver, PipelineStep } from "@tscircuit/solver-utils"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import {
  MultiGraphTopologyPlannerSolver,
  type MultiGraphTopologyPlannerSolverOutput,
  type MultiGraphTopologyPlannerSolverParams,
} from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import {
  ComponentTopologyBatchSolver,
  type ComponentTopologyBatchSolverOutput,
  createComponentSrj,
  normalizeInput,
} from "lib/solvers/TopologyPlanningSolver/topologyPlanningShared"
import { ApproximateHypergraphTopologySolver } from "./ApproximateHypergraphTopologySolver"

export interface ApproximateMultiGraphTopologyPlannerSolverParams
  extends MultiGraphTopologyPlannerSolverParams {
  targetCellSize?: number
  obstacleSamplingMargin?: number
}

/**
 * Keeps exact component-local topology while replacing only the global
 * free-space RectDiff solve with a coarse uniform mesh.
 */
export class ApproximateMultiGraphTopologyPlannerSolver extends MultiGraphTopologyPlannerSolver {
  approximateGlobalTopologySolver?: ApproximateHypergraphTopologySolver

  private readonly approximateParams: ApproximateMultiGraphTopologyPlannerSolverParams
  private readonly approximateInput: ReturnType<typeof normalizeInput>

  override pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "approximateGlobalTopologySolver",
      ApproximateHypergraphTopologySolver,
      (instance: ApproximateMultiGraphTopologyPlannerSolver) => [
        {
          simpleRouteJson: instance.approximateInput.globalNoConnectionSrj,
          targetCellSize: instance.approximateParams.targetCellSize,
          obstacleSamplingMargin:
            instance.approximateParams.obstacleSamplingMargin,
          generatePortsAndEdges: false,
        },
      ],
    ),
    definePipelineStep(
      "componentTopologyBatchSolver",
      ComponentTopologyBatchSolver,
      (instance: ApproximateMultiGraphTopologyPlannerSolver) => [
        {
          componentSrjs: instance.getApproximateComponentSrjs(),
          componentIds: instance.approximateInput.components.map(
            (component) => component.componentId,
          ),
          componentKinds: instance.approximateInput.components.map(
            (component) => component.componentKind,
          ),
          viaDiameter: instance.inputProblem.viaDiameter,
          obstacleMargin: instance.inputProblem.obstacleMargin,
        },
      ],
    ),
  ]

  constructor(params: ApproximateMultiGraphTopologyPlannerSolverParams) {
    super(params)
    this.approximateParams = params
    this.approximateInput = normalizeInput(params)
  }

  override getConstructorParams() {
    return [this.approximateParams] as const
  }

  override getOutput(): MultiGraphTopologyPlannerSolverOutput {
    const globalMeshNodes = (
      this.getStageOutput<{
        capacityMeshNodes: CapacityMeshNode[]
      }>("approximateGlobalTopologySolver")?.capacityMeshNodes ?? []
    ).map((node) => ({
      ...node,
      _containsObstacle: undefined,
      _completelyInsideObstacle: undefined,
      _containsTarget: undefined,
      _targetConnectionName: undefined,
      _connectedTo: undefined,
    }))
    const componentMeshNodes =
      this.getStageOutput<ComponentTopologyBatchSolverOutput>(
        "componentTopologyBatchSolver",
      )?.componentMeshNodes ?? []

    return {
      globalNoConnectionSrj: this.approximateInput.globalNoConnectionSrj,
      componentNoConnectionSrjs: this.getApproximateComponentSrjs(),
      globalMeshNodes,
      componentMeshNodes,
    }
  }

  private getApproximateComponentSrjs(): SimpleRouteJson[] {
    return this.approximateInput.components.map((component) =>
      createComponentSrj({
        inputSrj: this.inputProblem.inputSrj,
        component,
      }),
    )
  }
}
