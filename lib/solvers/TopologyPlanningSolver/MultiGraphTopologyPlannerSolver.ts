import { BasePipelineSolver, definePipelineStep } from "@tscircuit/solver-utils"
import type { BaseSolver, PipelineStep } from "@tscircuit/solver-utils"
import { RectDiffPipeline } from "@tscircuit/rectdiff"
import type { GraphicsObject } from "graphics-debug"
import type { ComponentDetectionSolverOutput } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { getStringColor, safeTransparentize } from "lib/solvers/colors"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import {
  ComponentTopologyBatchSolver,
  type ComponentTopologyBatchSolverOutput,
  type NormalizedTopologyPlannerInput,
  createComponentSrj,
  mergeMeshNodes,
  normalizeInput,
} from "./topologyPlanningShared"

export type TopologyMeshMergeStrategy = "concat"

export interface SerializedTopologyComponentInput {
  componentId: string
  memberObstacleIds: string[]
  memberObstacles: Obstacle[]
  replacementObstacle: Obstacle
}

export interface MultiGraphTopologyPlannerSolverParams {
  inputSrj: SimpleRouteJson
  globalNoConnectionSrj?: SimpleRouteJson
  components?: SerializedTopologyComponentInput[]
  componentDetectionOutput?: ComponentDetectionSolverOutput
  brokenSrj?: {
    global: SimpleRouteJson
    components: SerializedTopologyComponentInput[]
  }
}

export interface MultiGraphTopologyPlannerSolverOutput {
  globalNoConnectionSrj: SimpleRouteJson
  componentNoConnectionSrjs: SimpleRouteJson[]
  globalMeshNodes: CapacityMeshNode[]
  componentMeshNodes: CapacityMeshNode[][]
  mergedMeshNodes: CapacityMeshNode[]
}

/**
 * Produces a merged routing topology where component replacement regions from
 * the global solve are substituted with component-local routing regions.
 */
export class MultiGraphTopologyPlannerSolver extends BasePipelineSolver<MultiGraphTopologyPlannerSolverParams> {
  globalTopologySolver?: RectDiffPipeline
  componentTopologyBatchSolver?: ComponentTopologyBatchSolver

  private normalizedInput: NormalizedTopologyPlannerInput

  pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "globalTopologySolver",
      RectDiffPipeline,
      (instance: MultiGraphTopologyPlannerSolver) => [
        instance.getGlobalTopologySolverInput(),
      ],
    ),
    definePipelineStep(
      "componentTopologyBatchSolver",
      ComponentTopologyBatchSolver,
      (instance: MultiGraphTopologyPlannerSolver) => [
        {
          componentSrjs: instance.getComponentNoConnectionSrjs(),
          componentIds: instance.normalizedInput.components.map(
            (component) => component.componentId,
          ),
          replacementObstacleIds: instance.normalizedInput.components.map(
            (component) => component.replacementObstacle.obstacleId,
          ),
        },
      ],
    ),
  ]

  constructor(params: MultiGraphTopologyPlannerSolverParams) {
    super(params)
    this.normalizedInput = normalizeInput(params)
  }

  override getConstructorParams() {
    return [this.inputProblem] as const
  }

  /**
   * Returns the global solve, the per-component solves, and the merged routing
   * regions used by downstream stages.
   */
  override getOutput(): MultiGraphTopologyPlannerSolverOutput {
    const globalMeshNodes =
      this.getStageOutput<{ meshNodes: CapacityMeshNode[] }>(
        "globalTopologySolver",
      )?.meshNodes ?? []
    const componentMeshNodes =
      this.getStageOutput<ComponentTopologyBatchSolverOutput>(
        "componentTopologyBatchSolver",
      )?.componentMeshNodes ?? []
    const componentNoConnectionSrjs = this.getComponentNoConnectionSrjs()

    return {
      globalNoConnectionSrj: this.normalizedInput.globalNoConnectionSrj,
      componentNoConnectionSrjs,
      globalMeshNodes,
      componentMeshNodes,
      mergedMeshNodes: mergeMeshNodes({
        globalMeshNodes,
        components: this.normalizedInput.components,
        componentMeshNodes,
        mergeStrategy: "concat",
      }),
    }
  }

  override finalVisualize(): GraphicsObject | null {
    const output = this.getOutput()
    const componentObstacleRects = output.componentNoConnectionSrjs.flatMap(
      (componentSrj, componentIndex) => {
        const component =
          this.normalizedInput.components[componentIndex] ?? null
        const componentColor = component
          ? getStringColor(component.componentId)
          : "rgba(120, 120, 120, 0.8)"

        return componentSrj.obstacles.map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: safeTransparentize(componentColor, 0.82),
          stroke: safeTransparentize(componentColor, 0.45),
          label:
            obstacle.obstacleId ?? component?.componentId ?? "component-pad",
          layer: obstacle.layers.join(","),
        }))
      },
    )

    return {
      title: "Topology Planning: merged mesh",
      rects: [
        ...componentObstacleRects,
        ...output.mergedMeshNodes.map((node) => {
          const component = this.normalizedInput.components.find(
            (candidate) =>
              candidate.componentId &&
              node.capacityMeshNodeId.includes(candidate.componentId),
          )
          const componentColor = component
            ? getStringColor(component.componentId)
            : "rgba(0, 200, 200, 0.8)"
          const rect = createRectFromCapacityNode(node, { rectMargin: 0.01 })
          return {
            ...rect,
            fill: safeTransparentize(componentColor, 0.8),
            stroke: safeTransparentize(componentColor, 0.2),
          }
        }),
      ],
      lines: [],
      points: [],
      circles: [],
      texts: [],
    }
  }

  /** Rebuilds each component-local SRJ from its original member obstacles. */
  private getComponentNoConnectionSrjs(): SimpleRouteJson[] {
    return this.normalizedInput.components.map((component) =>
      createComponentSrj({
        inputSrj: this.inputProblem.inputSrj,
        component,
      }),
    )
  }

  /** Adapts the global no-connection SRJ into the RectDiffPipeline input shape. */
  private getGlobalTopologySolverInput() {
    return {
      simpleRouteJson: this.normalizedInput.globalNoConnectionSrj as any,
    }
  }
}
