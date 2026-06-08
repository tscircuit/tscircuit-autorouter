import { RectDiffPipeline } from "@tscircuit/rectdiff"
import { BasePipelineSolver, definePipelineStep } from "@tscircuit/solver-utils"
import type { BaseSolver, PipelineStep } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { ComponentKind } from "lib/solvers/ComponentDetectionSolver/detectors/types"
import { safeTransparentize } from "lib/solvers/colors"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import {
  ComponentTopologyBatchSolver,
  type ComponentTopologyBatchSolverOutput,
  type NormalizedTopologyPlannerInput,
  createComponentSrj,
  filterMeshNodesInsideComponentAreas,
  filterRectDiffNodeRectsInsideComponentAreas,
  mergeMeshNodes,
  normalizeInput,
} from "./topologyPlanningShared"

export type TopologyMeshMergeStrategy = "concat"

export interface SerializedTopologyComponentInput {
  componentId: string
  componentKind?: ComponentKind
  memberObstacleIds: string[]
  memberObstacles: Obstacle[]
  replacementObstacle: Obstacle
}

export interface MultiGraphTopologyPlannerSolverParams {
  inputSrj: SimpleRouteJson
  globalNoConnectionSrj?: SimpleRouteJson
  components?: SerializedTopologyComponentInput[]
  componentDetectionOutput?: DetectedComponent[]
  viaDiameter?: number
  obstacleMargin?: number
  brokenSrj?: {
    componentsAsObstaclesSrj: SimpleRouteJson
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
          componentKinds: instance.normalizedInput.components.map(
            (component) => component.componentKind,
          ),
          replacementObstacleIds: instance.normalizedInput.components.map(
            (component) => component.replacementObstacle.obstacleId,
          ),
          viaDiameter: instance.inputProblem.viaDiameter,
          obstacleMargin: instance.inputProblem.obstacleMargin,
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
    const rawGlobalMeshNodes =
      this.getStageOutput<{ meshNodes: CapacityMeshNode[] }>(
        "globalTopologySolver",
      )?.meshNodes ?? []
    const globalMeshNodes = filterMeshNodesInsideComponentAreas({
      meshNodes: rawGlobalMeshNodes,
      components: this.normalizedInput.components,
    })
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

        return componentSrj.obstacles.map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(120, 120, 120, 0.06)",
          stroke: "rgba(120, 120, 120, 0.35)",
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
          const rect = createRectFromCapacityNode(node, { rectMargin: 0.01 })
          return {
            ...rect,
            fill: node._containsObstacle
              ? safeTransparentize("red", 0.82)
              : "rgba(0, 120, 255, 0.12)",
            stroke: node._containsObstacle
              ? safeTransparentize("red", 0.3)
              : "rgba(0, 120, 255, 0.55)",
            label: component
              ? `${component.componentKind?.toUpperCase() ?? "BGA"} ${node.capacityMeshNodeId}`
              : node.capacityMeshNodeId,
          }
        }),
      ],
      lines: [],
      points: [],
      circles: [],
      texts: [],
    }
  }

  override visualize(): GraphicsObject {
    return this.filterGlobalRectDiffNodesFromVisualization({
      visualization: super.visualize(),
    })
  }

  override preview(): GraphicsObject {
    return this.filterGlobalRectDiffNodesFromVisualization({
      visualization: super.preview(),
    })
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

  /**
   * Removes raw RectDiff node rects that are superseded by component-local
   * topology regions.
   *
   * @param params.visualization - Graphics output produced by the base
   *   pipeline visualizer, including nested stage visualizations.
   * @returns A visualization with RectDiff node rectangles inside component
   *   areas removed. Non-RectDiff rectangles and all lines, points, circles,
   *   and text entries are returned unchanged.
   *
   * @note This keeps intermediate RectDiff visualization consistent with the
   * merged topology output, which already removes those nodes from solver data.
   */
  private filterGlobalRectDiffNodesFromVisualization({
    visualization,
  }: {
    visualization: GraphicsObject
  }): GraphicsObject {
    return {
      ...visualization,
      rects: filterRectDiffNodeRectsInsideComponentAreas({
        rects: visualization.rects,
        components: this.normalizedInput.components,
      }),
    }
  }
}
