import { doBoundsOverlap, getBoundingBox, getBoundFromCenteredRect } from "@tscircuit/math-utils"
import { BaseSolver, BasePipelineSolver, definePipelineStep, PipelineStep } from "@tscircuit/solver-utils"
import {
  TopologyGenerator,
  type TopologyGeneratorSolverOutput,
  type TopologyGeneratorSolverParams,
} from "lib/solvers/TopologyPlanningSolver/TopologyGenerator"
import { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { getRerouteSimpleRouteJson } from "lib/utils/getRerouteSimpleRouteJson"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { getBenchmarkSolverOptions } from "scripts/benchmark/benchmark-run-task"


class InitialTopology extends BaseSolver {
  obstaclesPartOfComponent: Obstacle[] = []
  freeMeshNodes: CapacityMeshNode[] = []

  constructor(public readonly inputProblem: {
    srj: SimpleRouteJson,
    compoentBounds: SimpleRouteJson["bounds"],
    componentId: string
  }) {
    super()
  }


  getConstructorParams() {
    return [this.inputProblem] as const
  }

  step() {
    const {srj, compoentBounds, componentId} = this.inputProblem

    const obstaclesPartOfComponent = srj.obstacles.filter(obstacle => {
      return doBoundsOverlap(getBoundFromCenteredRect(obstacle), compoentBounds) && obstacle.componentId === componentId
    })

    const getAllCopperPours = srj.obstacles.filter(obstacle => {
      return obstacle.isCopperPour === true
    })

    const getCopperPourInsideOurComponentBounds = getAllCopperPours.filter(obstacle => {
      return doBoundsOverlap(getBoundFromCenteredRect(obstacle), compoentBounds)
    })

    const blockedLayers = getCopperPourInsideOurComponentBounds.map(obstacle => obstacle.layers.map(mapLayerNameToZ)).flat()

    const freeLayers = Array.from({length: srj.layerCount}, (_, i) => i).filter(
      (layer) => !blockedLayers.includes(layer)
    )

    const sortedYs = [...new Set(obstaclesPartOfComponent.map(obstacle => obstacle.center.y).sort((a,b) => a - b))]
    const sortedXs = [...new Set(obstaclesPartOfComponent.map(obstacle => obstacle.center.x).sort((a,b) => a - b))]

    let minXDiff = sortedXs[1] - sortedXs[0]
    let minYDiff = sortedYs[1] - sortedYs[0]

    for(let i = 1; i < sortedXs.length - 1; i++) {
      minXDiff = Math.min(minXDiff, sortedXs[i] - sortedXs[i  -1])
    }

    for(let i = 1; i < sortedYs.length - 1; i++) {
      minYDiff = Math.min(minYDiff, sortedYs[i] - sortedYs[i - 1])
    }

    const pitchX = minXDiff
    const pitchY = minYDiff

    const numRows = sortedYs.length
    const numCols = sortedXs.length

    const freeSpceInPitchX = pitchX - obstaclesPartOfComponent[0].width
    const freeSpceInPitchY = pitchY - obstaclesPartOfComponent[0].height

    // Vertical Placement
    for(let row = 0; row < numRows; row++) {
      for(let col = 0; col < numCols - 1; col++) {
        const distance = Math.abs(sortedXs[col] - sortedXs[col + 1])
        if(distance >= pitchX * 2) continue
        const centerX = (sortedXs[col] + sortedXs[col + 1]) / 2
        const centerY = sortedYs[row]
        const width = freeSpceInPitchX
        const height = obstaclesPartOfComponent[0].height

        this.freeMeshNodes.push({
          center: { x: centerX, y: centerY },
          width,
          height,
          availableZ: freeLayers,
          capacityMeshNodeId: `cmn_v_${componentId}_${row}_${col}`,
          layer: ""
        })
      }
    }

    for(let row = 0; row < numRows - 1; row++) {
      for(let col = 0; col < numCols; col++) {
        const distance = Math.abs(sortedYs[row] - sortedYs[row + 1])
        if(distance >= pitchY * 2) continue
        const centerX = sortedXs[col]
        const centerY = (sortedYs[row] + sortedYs[row + 1]) / 2
        const width = obstaclesPartOfComponent[0].width
        const height = freeSpceInPitchY

        this.freeMeshNodes.push({
          center: { x: centerX, y: centerY },
          width,
          height,
          availableZ: freeLayers,
          capacityMeshNodeId: `cmn_h_${componentId}_${row}_${col}`,
          layer: ""
        })
      }
    }

    this.solved = true
  }

  getOutput(): TopologyGeneratorSolverOutput {
    return {
      routingRegions: this.freeMeshNodes
    }
  }
}

export class BgaTopologyGeneratorSolver extends BasePipelineSolver<any> {
  static readonly componentKind = "bga"
  initialTopologySolver!: InitialTopology

  pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "initialTopologySolver",
      InitialTopology,
      (solver: BgaTopologyGeneratorSolver) => [
        {
          srj: solver.inputProblem.inputSrj,
          compoentBounds: solver.inputProblem.detectedComponent.bounds,
          componentId: solver.inputProblem.detectedComponent.componentId
        }
      ]
    )
  ]

  constructor(public readonly inputProblem: TopologyGeneratorSolverParams) {
    super(inputProblem)
  }

  override getConstructorParams() {
    return [this.inputProblem] as const
  }

  getOutput(): TopologyGeneratorSolverOutput {
    return this.initialTopologySolver.getOutput()
  }
}

TopologyGenerator.register(BgaTopologyGeneratorSolver)
