import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { MultiGraphTopologyPlannerSolver } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type { CapacityMeshNode } from "lib/types"

export class MergedComponentTopologyView extends BaseSolver {
  constructor(
    private readonly topologyPlanningSolver: MultiGraphTopologyPlannerSolver,
  ) {
    super()
    this.solved = topologyPlanningSolver.solved
    this.failed = topologyPlanningSolver.failed
    this.error = topologyPlanningSolver.error
    this.stats = topologyPlanningSolver.stats
  }

  getOutput(): CapacityMeshNode[] {
    return this.topologyPlanningSolver.getOutput().componentMeshNodes.flat()
  }

  override visualize(): GraphicsObject {
    return (
      this.topologyPlanningSolver.finalVisualize() ??
      this.topologyPlanningSolver.visualize()
    )
  }

  override preview(): GraphicsObject {
    return this.visualize()
  }
}
