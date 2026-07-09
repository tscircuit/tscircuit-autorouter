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
  TopologyMergeSolver,
  type TopologyMergeSolverOutput,
} from "./TopologyMergeSolver"
import {
  ComponentTopologyBatchSolver,
  type ComponentTopologyBatchSolverOutput,
  type NormalizedTopologyPlannerInput,
  createComponentSrj,
  filterRectDiffNodeRectsInsideComponentAreas,
  normalizeInput,
} from "./topologyPlanningShared"

export type TopologyMeshMergeStrategy = "concat"

export interface SerializedTopologyComponentInput {
  componentId: string
  componentKind: ComponentKind
  memberObstacleIds: string[]
  memberObstacles: Obstacle[]
  replacementObstacle: Obstacle & { obstacleId: string }
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
  topologyInterfaceMeshNodes: CapacityMeshNode[]
  mergedMeshNodes: CapacityMeshNode[]
}

/**
 * Produces a merged routing topology where component replacement regions from
 * the global solve are substituted with component-local routing regions.
 */
export class MultiGraphTopologyPlannerSolver extends BasePipelineSolver<MultiGraphTopologyPlannerSolverParams> {
  globalTopologySolver?: RectDiffPipeline
  componentTopologyBatchSolver?: ComponentTopologyBatchSolver
  topologyMergeSolver?: TopologyMergeSolver

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
          viaDiameter: instance.inputProblem.viaDiameter,
          obstacleMargin: instance.inputProblem.obstacleMargin,
        },
      ],
    ),
    definePipelineStep(
      "topologyMergeSolver",
      TopologyMergeSolver,
      (instance: MultiGraphTopologyPlannerSolver) => [
        instance.getTopologyMergeSolverInput(),
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
    const rawComponentMeshNodes =
      this.getStageOutput<ComponentTopologyBatchSolverOutput>(
        "componentTopologyBatchSolver",
      )?.componentMeshNodes ?? []
    const mergeOutput = this.getStageOutput<TopologyMergeSolverOutput>(
      "topologyMergeSolver",
    ) ?? {
      globalMeshNodes: rawGlobalMeshNodes,
      componentMeshNodes: rawComponentMeshNodes,
      topologyInterfaceMeshNodes: [],
      mergedMeshNodes: rawGlobalMeshNodes,
    }
    const componentNoConnectionSrjs = this.getComponentNoConnectionSrjs()

    return {
      globalNoConnectionSrj: this.normalizedInput.globalNoConnectionSrj,
      componentNoConnectionSrjs,
      globalMeshNodes: mergeOutput.globalMeshNodes,
      componentMeshNodes: mergeOutput.componentMeshNodes,
      topologyInterfaceMeshNodes: mergeOutput.topologyInterfaceMeshNodes,
      mergedMeshNodes: mergeOutput.mergedMeshNodes,
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
          const component = this.normalizedInput.components.find((candidate) =>
            node.capacityMeshNodeId.includes(candidate.componentId),
          )
          const rect = createRectFromCapacityNode(node, { rectMargin: 0.01 })
          const isInterfaceNode = node._topologyMergeRole === "interface"
          const isComponentNode = node._topologyMergeRole === "component"
          return {
            ...rect,
            fill: node._containsObstacle
              ? safeTransparentize("red", 0.82)
              : isInterfaceNode
                ? "rgba(255, 155, 20, 0.28)"
                : isComponentNode
                  ? "rgba(0, 120, 255, 0.12)"
                  : "rgba(70, 80, 95, 0.1)",
            stroke: node._containsObstacle
              ? safeTransparentize("red", 0.3)
              : isInterfaceNode
                ? "rgba(205, 110, 0, 0.78)"
                : isComponentNode
                  ? "rgba(0, 120, 255, 0.55)"
                  : "rgba(70, 80, 95, 0.42)",
            label: isInterfaceNode
              ? [
                  `INTERFACE ${node.capacityMeshNodeId}`,
                  `availableZ: ${node.availableZ.join(",")}`,
                  node._topologyMergeSourceNodeIds?.length
                    ? `from: ${node._topologyMergeSourceNodeIds.join(",")}`
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n")
              : component
                ? `${component.componentKind.toUpperCase()} ${node.capacityMeshNodeId}`
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
      maxGapFillPasses: 4,
    }
  }

  /** Builds the explicit component/global topology interface merge input. */
  private getTopologyMergeSolverInput(): TopologyMergeSolver["inputProblem"] {
    const rawGlobalMeshNodes =
      this.getStageOutput<{ meshNodes: CapacityMeshNode[] }>(
        "globalTopologySolver",
      )?.meshNodes ?? []
    const componentMeshNodes =
      this.getStageOutput<ComponentTopologyBatchSolverOutput>(
        "componentTopologyBatchSolver",
      )?.componentMeshNodes ?? []

    return {
      globalMeshNodes: rawGlobalMeshNodes,
      components: this.normalizedInput.components,
      componentMeshNodes,
      layerCount: this.inputProblem.inputSrj.layerCount,
      viaDiameter:
        this.inputProblem.viaDiameter ??
        this.inputProblem.inputSrj.minViaPadDiameter ??
        this.inputProblem.inputSrj.min_via_pad_diameter ??
        this.inputProblem.inputSrj.minViaDiameter,
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
