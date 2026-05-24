import { BasePipelineSolver, definePipelineStep } from "@tscircuit/solver-utils"
import type { BaseSolver, PipelineStep } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { getStringColor, safeTransparentize } from "lib/solvers/colors"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { RectBoundsComponentDetectionStage } from "./RectBoundsComponentDetectionStage"

export interface ComponentDetectionSolverParams {
  inputSrj: SimpleRouteJson
}

export interface DetectedComponent {
  componentId: string
  componentKind: "bga" | "qfp"
  memberObstacleIds: string[]
  memberObstacles: Obstacle[]
  replacementObstacle: Obstacle
}

export interface ComponentDetectionSolverOutput {
  global: SimpleRouteJson
  components: DetectedComponent[]
}

const formatObstacleLabel = (obstacle: Obstacle) => {
  if (obstacle.componentId && obstacle.obstacleId) {
    return `${obstacle.componentId}\n${obstacle.obstacleId}`
  }

  return obstacle.componentId ?? obstacle.obstacleId ?? "obstacle"
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
    const { bounds } = this.inputProblem.inputSrj

    return {
      title: "Component Detection: board and grouped component pads",
      rects: [
        {
          center: {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
          },
          width: bounds.maxX - bounds.minX,
          height: bounds.maxY - bounds.minY,
          fill: "rgba(0, 0, 0, 0)",
          stroke: "rgba(40, 40, 40, 0.7)",
          label: "Board bounds",
          step: 0,
        },
        ...this.inputProblem.inputSrj.obstacles.map((obstacle) => {
          const componentColor = obstacle.componentId
            ? getStringColor(obstacle.componentId)
            : null

          return {
            center: obstacle.center,
            width: obstacle.width,
            height: obstacle.height,
            fill: componentColor
              ? safeTransparentize(componentColor, 0.72)
              : "rgba(120, 120, 120, 0.10)",
            stroke: componentColor
              ? safeTransparentize(componentColor, 0.28)
              : "rgba(120, 120, 120, 0.40)",
            label: formatObstacleLabel(obstacle),
            layer: obstacle.layers.join(","),
            step: obstacle.componentId ? 1 : 0,
          }
        }),
      ],
      lines: [],
      points: [],
      circles: [],
    }
  }
}
