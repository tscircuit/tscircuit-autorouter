import {
  doBoundsOverlap,
  getBoundFromCenteredRect,
} from "@tscircuit/math-utils"
import { BasePipelineSolver, definePipelineStep } from "@tscircuit/solver-utils"
import type { BaseSolver, PipelineStep } from "@tscircuit/solver-utils"
import { GapFill } from "lib/solvers/BgaTopologyGeneratorSolver/GapFill"
import { InitialBgaTopologySolver } from "lib/solvers/BgaTopologyGeneratorSolver/InitialBgaTopologySolver"
import { MergeMeshNodes } from "lib/solvers/BgaTopologyGeneratorSolver/MergeMeshNodes"
import { RemoveMeshNodeOverlappingWithUnmarkedObstacle } from "lib/solvers/BgaTopologyGeneratorSolver/RemoveMeshNodeOverlappingSolver"
import {
  TopologyGenerator,
  type TopologyGeneratorSolverOutput,
  type TopologyGeneratorSolverParams,
} from "lib/solvers/TopologyPlanningSolver/TopologyGenerator"
import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNode, Obstacle } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { getViaDimensions } from "lib/utils/getViaDimensions"

export class BgaTopologyGeneratorSolver extends BasePipelineSolver<TopologyGeneratorSolverParams> {
  static readonly componentKind = "bga"

  initialTopologySolver!: InitialBgaTopologySolver
  removeMeshNodeOverlappingWithUnmarkedObstacle!: RemoveMeshNodeOverlappingWithUnmarkedObstacle
  gapfillDueToNodeRemoval!: GapFill
  mergeMeshNodes!: MergeMeshNodes
  markedComponentObstacles: Obstacle[] = []
  unmarkedComponentObstacles: Obstacle[] = []

  pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "initialTopologySolver",
      InitialBgaTopologySolver,
      (bgaTopologyGeneratorSolver: BgaTopologyGeneratorSolver) => [
        {
          srj: bgaTopologyGeneratorSolver.inputProblem.inputSrj,
          componentBounds:
            bgaTopologyGeneratorSolver.inputProblem.detectedComponent.bounds,
          componentId:
            bgaTopologyGeneratorSolver.inputProblem.detectedComponent
              .componentId,
          markedComponentObstacles:
            bgaTopologyGeneratorSolver.markedComponentObstacles,
          unmarkedComponentObstacles:
            bgaTopologyGeneratorSolver.unmarkedComponentObstacles,
          viaDiameter:
            bgaTopologyGeneratorSolver.inputProblem.viaDiameter ??
            getViaDimensions(
              bgaTopologyGeneratorSolver.inputProblem.inputSrj,
            ).padDiameter,
        },
      ],
    ),
    definePipelineStep(
      "removeMeshNodeOverlappingWithUnmarkedObstacle",
      RemoveMeshNodeOverlappingWithUnmarkedObstacle,
      (bgaTopologyGeneratorSolver: BgaTopologyGeneratorSolver) => [
        {
          meshNodes:
            bgaTopologyGeneratorSolver.initialTopologySolver.getOutput(),
          obstacles: bgaTopologyGeneratorSolver.unmarkedComponentObstacles,
          layerCount:
            bgaTopologyGeneratorSolver.inputProblem.inputSrj.layerCount,
          viaDiameter: bgaTopologyGeneratorSolver.inputProblem.viaDiameter,
        },
      ],
    ),
    definePipelineStep(
      "gapfillDueToNodeRemoval",
      GapFill,
      (bgaTopologyGeneratorSolver: BgaTopologyGeneratorSolver) => [
        {
          meshNodes:
            bgaTopologyGeneratorSolver.removeMeshNodeOverlappingWithUnmarkedObstacle.getOutput(),
          unmarkedComponentObstacles:
            bgaTopologyGeneratorSolver.unmarkedComponentObstacles,
          layerCount:
            bgaTopologyGeneratorSolver.inputProblem.inputSrj.layerCount,
        },
      ],
    ),
    definePipelineStep(
      "mergeMeshNodes",
      MergeMeshNodes,
      (bgaTopologyGeneratorSolver: BgaTopologyGeneratorSolver) => [
        {
          meshNodes:
            bgaTopologyGeneratorSolver.gapfillDueToNodeRemoval.getOutput(),
          layerCount:
            bgaTopologyGeneratorSolver.inputProblem.inputSrj.layerCount,
        },
      ],
    ),
  ]

  constructor(public readonly inputProblem: TopologyGeneratorSolverParams) {
    super(inputProblem)
  }

  override _setup(): void {
    const componentBounds = this.inputProblem.detectedComponent.bounds
    const componentId = this.inputProblem.detectedComponent.componentId
    const markedComponentObstacles: Obstacle[] = []
    const unmarkedComponentObstacles: Obstacle[] = []

    for (const obstacle of this.inputProblem.inputSrj.obstacles) {
      const obstacleBounds = getBoundFromCenteredRect(obstacle)

      if (!doBoundsOverlap(componentBounds, obstacleBounds)) {
        continue
      }

      if (obstacle.componentId === componentId) {
        markedComponentObstacles.push(obstacle)
        continue
      }

      unmarkedComponentObstacles.push(obstacle)
    }

    this.markedComponentObstacles = markedComponentObstacles
    this.unmarkedComponentObstacles = unmarkedComponentObstacles
  }

  override getConstructorParams(): readonly [TopologyGeneratorSolverParams] {
    return [this.inputProblem] as const
  }

  override getOutput(): TopologyGeneratorSolverOutput {
    const routingRegions: CapacityMeshNode[] =
      this.mergeMeshNodes?.getOutput() ??
      this.gapfillDueToNodeRemoval?.getOutput() ??
      this.removeMeshNodeOverlappingWithUnmarkedObstacle?.getOutput() ??
      []

    return {
      routingRegions,
    }
  }

  override initialVisualize(): GraphicsObject | null {
    return {
      rects: [
        {
          center: {
            x:
              (this.inputProblem.detectedComponent.bounds.minX +
                this.inputProblem.detectedComponent.bounds.maxX) /
              2,
            y:
              (this.inputProblem.detectedComponent.bounds.minY +
                this.inputProblem.detectedComponent.bounds.maxY) /
              2,
          },
          width:
            this.inputProblem.detectedComponent.bounds.maxX -
            this.inputProblem.detectedComponent.bounds.minX,
          height:
            this.inputProblem.detectedComponent.bounds.maxY -
            this.inputProblem.detectedComponent.bounds.minY,
          fill: "rgba(0,0,0,0)",
          stroke: "rgba(30,30,30,0.65)",
          label: `bga ${this.inputProblem.detectedComponent.componentId}`,
        },
        ...this.markedComponentObstacles.map((obstacle: Obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(255,0,0,0.18)",
          stroke: "rgba(255,0,0,0.52)",
          label: `pad ${obstacle.obstacleId ?? "obstacle"}`,
        })),
        ...this.unmarkedComponentObstacles.map((obstacle: Obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(255,140,0,0.14)",
          stroke: "rgba(255,140,0,0.42)",
          label: `foreign ${obstacle.obstacleId ?? "obstacle"}`,
        })),
      ],
    }
  }

  override finalVisualize(): GraphicsObject | null {
    return {
      rects: this.getOutput().routingRegions.map((node: CapacityMeshNode) => ({
        ...createRectFromCapacityNode(node, { rectMargin: 0.01 }),
        fill: node._containsObstacle
          ? "rgba(255,0,0,0.16)"
          : "rgba(0,120,255,0.12)",
        stroke: node._containsObstacle
          ? "rgba(255,0,0,0.36)"
          : "rgba(0,120,255,0.42)",
      })),
    }
  }
}

TopologyGenerator.register(BgaTopologyGeneratorSolver)
