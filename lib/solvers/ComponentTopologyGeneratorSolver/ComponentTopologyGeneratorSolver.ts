import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import {
  TopologyGenerator,
  type TopologyGeneratorSolver,
} from "lib/solvers/TopologyPlanningSolver/TopologyGenerator"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import "lib/solvers/BgaTopologyGeneratorSolver/BgaTopologyGeneratorSolver"
import "lib/solvers/QfpThermalPadTopologyGeneratorSolver/QfpThermalPadTopologyGeneratorSolver"
import "lib/solvers/QfpTopologyGeneratorSolver/QfpTopologyGeneratorSolver"
import "lib/solvers/SoicTopologyGeneratorSolver/SoicTopologyGeneratorSolver"

export interface ComponentTopologyGeneratorSolverParams {
  detectedComponents: DetectedComponent[]
  inputSrj: SimpleRouteJson
}

export type ComponentTopologyGeneratorSolverOutput = CapacityMeshNode[]

export function createReplacementObstacleForComponent({
  detectedComponent,
  inputSrj,
}: {
  detectedComponent: DetectedComponent
  inputSrj: SimpleRouteJson
}): Obstacle {
  const memberObstacles = inputSrj.obstacles.filter(
    (obstacle) => obstacle.componentId === detectedComponent.componentId,
  )
  const layers = Array.from(
    new Set(memberObstacles.flatMap((obstacle) => obstacle.layers)),
  )
  const zLayers = Array.from(
    new Set(memberObstacles.flatMap((obstacle) => obstacle.zLayers ?? [])),
  )
  const connectedTo = Array.from(
    new Set(memberObstacles.flatMap((obstacle) => obstacle.connectedTo)),
  )
  const { bounds } = detectedComponent

  return {
    obstacleId: `${detectedComponent.componentId}_component_bounds`,
    componentId: detectedComponent.componentId,
    type: "rect",
    layers: layers.length > 0 ? layers : ["top", "bottom"],
    ...(zLayers.length > 0 ? { zLayers } : {}),
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    connectedTo,
  }
}

export function createComponentObstacleSrj({
  detectedComponents,
  inputSrj,
}: {
  detectedComponents: DetectedComponent[]
  inputSrj: SimpleRouteJson
}): SimpleRouteJson {
  const detectedComponentIds = new Set(
    detectedComponents.map((component) => component.componentId),
  )

  return {
    ...structuredClone(inputSrj),
    obstacles: [
      ...inputSrj.obstacles.filter(
        (obstacle) =>
          !obstacle.componentId ||
          !detectedComponentIds.has(obstacle.componentId),
      ),
      ...detectedComponents.map((detectedComponent) =>
        createReplacementObstacleForComponent({
          detectedComponent,
          inputSrj,
        }),
      ),
    ],
  }
}

function isPointInsideComponentBounds(
  point: { x: number; y: number },
  detectedComponent: DetectedComponent,
) {
  const { bounds } = detectedComponent

  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  )
}

function isObstacleInsideAnyComponentBounds(
  obstacle: Obstacle,
  detectedComponents: DetectedComponent[],
) {
  return detectedComponents.some((detectedComponent) =>
    isPointInsideComponentBounds(obstacle.center, detectedComponent),
  )
}

export class ComponentTopologyGeneratorSolver extends BaseSolver {
  private output: ComponentTopologyGeneratorSolverOutput = []
  private componentMeshNodes: CapacityMeshNode[][] = []
  private currentComponentIndex = 0
  private activeTopologyGenerator?: TopologyGeneratorSolver | null = null

  constructor(
    public readonly inputProblem: ComponentTopologyGeneratorSolverParams,
  ) {
    super()
  }

  override getConstructorParams() {
    return [this.inputProblem] as const
  }

  override _step() {
    if (this.activeTopologyGenerator) {
      this.activeTopologyGenerator.step()

      if (this.activeTopologyGenerator.failed) {
        this.error = this.activeTopologyGenerator.error
        this.failed = true
        this.activeTopologyGenerator = null
        return
      }

      if (!this.activeTopologyGenerator.solved) return

      this.componentMeshNodes.push(
        this.activeTopologyGenerator.getOutput().routingRegions,
      )
      this.currentComponentIndex += 1
      this.activeTopologyGenerator = null
      return
    }

    if (
      this.currentComponentIndex >= this.inputProblem.detectedComponents.length
    ) {
      this.finalizeComponentTopology()
      this.solved = true
      return
    }

    const detectedComponent =
      this.inputProblem.detectedComponents[this.currentComponentIndex]!
    this.activeTopologyGenerator = TopologyGenerator.create(
      detectedComponent.componentKind,
      {
        inputSrj: this.inputProblem.inputSrj,
        detectedComponent,
      },
    )
  }

  private finalizeComponentTopology() {
    this.output = this.componentMeshNodes.flat()
    this.stats = {
      detectedComponentCount: this.inputProblem.detectedComponents.length,
      componentMeshNodeCount: this.output.length,
      componentMeshNodeCounts: this.componentMeshNodes.map(
        (nodes) => nodes.length,
      ),
    }
  }

  createComponentObstacleSrj(
    inputSrj: SimpleRouteJson = this.inputProblem.inputSrj,
  ): SimpleRouteJson {
    return createComponentObstacleSrj({
      detectedComponents: this.inputProblem.detectedComponents,
      inputSrj,
    })
  }

  override visualize(): GraphicsObject {
    if (this.activeTopologyGenerator && !this.activeTopologyGenerator.solved) {
      return this.activeTopologyGenerator.visualize()
    }

    const outputNodes = this.solved
      ? this.output
      : this.componentMeshNodes.flat()
    const { bounds, outline, obstacles } = this.inputProblem.inputSrj
    const boardOutlinePoints = outline?.length
      ? [...outline, outline[0]!]
      : [
          { x: bounds.minX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.maxY },
          { x: bounds.minX, y: bounds.maxY },
          { x: bounds.minX, y: bounds.minY },
        ]
    const nonComponentObstacles = obstacles.filter(
      (obstacle) =>
        !isObstacleInsideAnyComponentBounds(
          obstacle,
          this.inputProblem.detectedComponents,
        ),
    )

    return {
      title: `Component Topology Generator: ${outputNodes.length} mesh nodes`,
      rects: [
        ...nonComponentObstacles.map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(120, 120, 120, 0.12)",
          stroke: "rgba(90, 90, 90, 0.45)",
          layer: obstacle.layers.join(","),
          label: obstacle.obstacleId ?? obstacle.componentId ?? "non-component",
        })),
        ...outputNodes.map((node) => ({
          ...createRectFromCapacityNode(node, {
            rectMargin: 0.01,
            zOffset: 0.02,
          }),
          stroke: node._containsObstacle
            ? "rgba(210, 50, 20, 0.75)"
            : "rgba(20, 110, 210, 0.75)",
          fill: node._containsObstacle
            ? "rgba(255, 80, 40, 0.18)"
            : "rgba(20, 130, 255, 0.16)",
          label: [
            node.capacityMeshNodeId,
            `availableZ: ${node.availableZ.join(",")}`,
            node._containsObstacle ? "containsObstacle" : "",
          ]
            .filter(Boolean)
            .join("\n"),
        })),
      ],
      lines: [
        {
          points: boardOutlinePoints,
          strokeColor: "rgba(40, 40, 40, 0.8)",
        },
      ],
      points: [],
      circles: [],
    }
  }

  getOutput(): ComponentTopologyGeneratorSolverOutput {
    if (!this.solved) {
      throw new Error("ComponentTopologyGeneratorSolver has not solved yet")
    }

    return this.output
  }
}
