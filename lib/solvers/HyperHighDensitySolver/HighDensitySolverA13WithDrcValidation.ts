import type { HighDensitySolverA13 } from "@tscircuit/high-density-a01"
import { HighDensitySolverA13WithBoundaryClearance } from "./HighDensitySolverA13WithBoundaryClearance"
import {
  validateHighDensityBoardCopper,
  type HighDensityBoardCopperValidationParams,
} from "./validateHighDensityBoardCopper"

type A13Params = ConstructorParameters<typeof HighDensitySolverA13>[0]
type ValidatedA13Params = A13Params &
  Pick<
    HighDensityBoardCopperValidationParams,
    "obstacles" | "connMap" | "layerCount" | "boardGeometry"
  >

/** A node-local search is provisional until it also clears fixed board copper. */
export class HighDensitySolverA13WithDrcValidation extends HighDensitySolverA13WithBoundaryClearance {
  constructor(readonly validationParams: ValidatedA13Params) {
    super(validationParams)
  }

  override _step(): void {
    super._step()
    if (!this.solved) return
    const validation = validateHighDensityBoardCopper({
      ...this.validationParams,
      nodeWithPortPoints: this.nodeWithPortPoints,
      routes: this.getOutput(),
      traceThickness: this.traceThickness,
      viaDiameter: this.viaDiameter,
      traceMargin: this.traceMargin,
    })
    this.stats.boardObstaclesChecked = validation.boardObstaclesChecked
    this.stats.boardDrcIssueCount = validation.boardDrcIssueCount
    if (validation.error !== null) {
      this.solved = false
      this.failed = true
      this.error = `A13 candidate fails board copper validation: ${validation.error}`
    }
  }
}
