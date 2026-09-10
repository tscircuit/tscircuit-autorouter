import {
  HighDensitySolverA11,
  type HighDensitySolverA11Props,
} from "@tscircuit/high-density-a01"
import { getNativeRouteValidationError } from "./getNativeRouteValidationError"
import {
  validateHighDensityBoardCopper,
  type HighDensityBoardCopperValidationParams,
} from "./validateHighDensityBoardCopper"

type ValidatedA11Params = HighDensitySolverA11Props &
  Pick<
    HighDensityBoardCopperValidationParams,
    "obstacles" | "connMap" | "layerCount" | "boardGeometry"
  >

/** Accept only complete, native-size A11 routes that clear fixed board copper. */
export class HighDensitySolverA11WithDrcValidation extends HighDensitySolverA11 {
  constructor(readonly validationParams: ValidatedA11Params) {
    super(validationParams)
  }

  override _step(): void {
    super._step()
    if (!this.solved) return
    const routes = this.getOutput()
    const nativeError = getNativeRouteValidationError(
      routes,
      this.nodeWithPortPoints,
    )
    if (nativeError !== null) {
      this.solved = false
      this.failed = true
      this.error = `A11 candidate fails native validation: ${nativeError}`
      return
    }
    const validation = validateHighDensityBoardCopper({
      ...this.validationParams,
      routes,
      traceThickness: this.traceThickness,
      viaDiameter: this.viaDiameter,
      traceMargin: this.traceMargin,
    })
    this.stats.boardObstaclesChecked = validation.boardObstaclesChecked
    this.stats.boardDrcIssueCount = validation.boardDrcIssueCount
    if (validation.error !== null) {
      this.solved = false
      this.failed = true
      this.error = `A11 candidate fails board copper validation: ${validation.error}`
    }
  }
}
