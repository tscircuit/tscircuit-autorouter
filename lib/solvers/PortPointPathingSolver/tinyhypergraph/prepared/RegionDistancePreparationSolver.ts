import { SolverRuntime } from "@tscircuit/solver-utils"
import { BaseSolver } from "../../../BaseSolver"

export type RegionDistancePreparationInput = {
  portX: Float64Array
  portY: Float64Array
  regions: number[][]
}

/** Static geometry only. Worker results never contain mutable routing state. */
export class RegionDistancePreparationSolver extends BaseSolver {
  static readonly solverName = "RegionDistancePreparationSolver"
  private output?: Float64Array

  constructor(private readonly input: RegionDistancePreparationInput) {
    super()
  }

  override _step(): void {
    const { portX, portY, regions } = this.input
    const distances = new Float64Array(regions.reduce((sum, ports) => sum + ports.length ** 2, 0))
    let offset = 0
    for (const ports of regions) {
      for (const from of ports) {
        for (const to of ports) {
          const dx = portX[from]! - portX[to]!
          const dy = portY[from]! - portY[to]!
          distances[offset++] = Math.sqrt(dx * dx + dy * dy)
        }
      }
    }
    this.output = distances
    this.solved = true
  }

  getOutput(): Float64Array {
    if (!this.output) throw new Error("Region distances have not been prepared")
    return this.output
  }
}

SolverRuntime.registerSolver(RegionDistancePreparationSolver)
