import type { GraphicsObject } from "graphics-debug"
import { BasePipelineSolver, definePipelineStep } from "@tscircuit/solver-utils"
import type { BaseSolver, PipelineStep } from "@tscircuit/solver-utils"
import { getStringColor, safeTransparentize } from "lib/solvers/colors"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { RectBoundsComponentDetectionStage } from "./RectBoundsComponentDetectionStage"

export interface ComponentDetectionSolverParams {
  inputSrj: SimpleRouteJson
}

export interface DetectedComponent {
  componentId: string
  memberObstacleIds: string[]
  memberObstacles: Obstacle[]
  replacementObstacle: Obstacle
}

export interface ComponentDetectionSolverOutput {
  global: SimpleRouteJson
  components: DetectedComponent[]
}

/**
 * Pipeline wrapper for component detection stages. The current pipeline only
 * runs the rectangular bounds stage, but later shape-specific stages can be
 * inserted here without changing the external solver API.
 */
export class ComponentDetectionSolver extends BasePipelineSolver<ComponentDetectionSolverParams> {
  rectBoundsComponentDetection?: RectBoundsComponentDetectionStage
  pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "rectBoundsComponentDetection",
      RectBoundsComponentDetectionStage,
      (instance: ComponentDetectionSolver) => [
        { inputSrj: instance.inputProblem.inputSrj },
      ],
    ),
  ]

  constructor(params: ComponentDetectionSolverParams) {
    super(params)
  }

  override getConstructorParams() {
    return [this.inputProblem] as const
  }

  override getOutput(): ComponentDetectionSolverOutput {
    const output = this.getStageOutput<ComponentDetectionSolverOutput>(
      "rectBoundsComponentDetection",
    )

    if (!output) {
      throw new Error("ComponentDetectionSolver has not solved yet")
    }

    return output
  }

  override initialVisualize(): GraphicsObject | null {
    return {
      title: "Component Detection: pipeline setup",
      rects: this.inputProblem.inputSrj.obstacles.map((obstacle) => {
        const componentColor = obstacle.componentId
          ? getStringColor(obstacle.componentId)
          : null

        return {
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: componentColor
            ? safeTransparentize(componentColor, 0.82)
            : "rgba(120, 120, 120, 0.10)",
          stroke: componentColor
            ? safeTransparentize(componentColor, 0.45)
            : "rgba(120, 120, 120, 0.40)",
          label: obstacle.componentId ?? obstacle.obstacleId,
          layer: obstacle.layers.join(","),
          step: 0,
        }
      }),
      lines: [],
      points: [],
      circles: [],
    }
  }
}
