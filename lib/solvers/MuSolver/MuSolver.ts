import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNode } from "lib/types"
import type { TopologyGeneratorSolverOutput } from "lib/solvers/TopologyPlanningSolver/TopologyGenerator"
import { BaseSolver } from "../BaseSolver"
import { mergeTwoTopologiesWithStats } from "./mergeTwoTopologies"
import { visualizeTopologyIsometric } from "./visualizeMergedTopology3D"

export interface MuSolverInput {
  topologyA: CapacityMeshNode[]
  topologyB: CapacityMeshNode[]
  layerCount: number
}

/**
 * Merges two independently-generated topologies into one by emitting layer-
 * correct seam regions inside their XY overlaps. Single-shot: the whole merge
 * runs on the first step. Output plugs into the topology-generator contract via
 * getOutput() -> { routingRegions }.
 */
export class MuSolver extends BaseSolver {
  mergedRegions: CapacityMeshNode[] = []

  constructor(public readonly inputProblem: MuSolverInput) {
    super()
  }

  override _step(): void {
    const { regions, seamStats } = mergeTwoTopologiesWithStats(
      this.inputProblem,
    )
    this.mergedRegions = regions

    this.stats = {
      topologyARegionCount: this.inputProblem.topologyA.length,
      topologyBRegionCount: this.inputProblem.topologyB.length,
      seamRegionCount:
        regions.length -
        this.inputProblem.topologyA.length -
        this.inputProblem.topologyB.length,
      seamsByCase: seamStats,
    }

    this.solved = true
  }

  getOutput(): TopologyGeneratorSolverOutput {
    return { routingRegions: this.mergedRegions }
  }

  override getConstructorParams(): readonly [MuSolverInput] {
    return [this.inputProblem] as const
  }

  override visualize(): GraphicsObject {
    return visualizeTopologyIsometric(this.mergedRegions)
  }
}
