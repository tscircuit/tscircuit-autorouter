import {
  DifferentialPairRoutingError,
  PostProcessingSolver,
  type PostProcessingSolverOutput,
  type PostProcessingSolverParams,
} from "@tscircuit/length-matching-solver"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../../solvers/BaseSolver"

/**
 * Keeps post-processing optional at the autorouter integration boundary.
 *
 * The length-matching package deliberately reports an infeasible coupled pair
 * as an error. Pipeline7 already has valid independently-routed copper at this
 * point, so an infeasible pair must preserve that copper instead of failing the
 * entire autoroute.
 */
export class SafePostProcessingSolver extends BaseSolver {
  readonly postProcessingSolver: PostProcessingSolver
  usedFallback = false

  constructor(public readonly inputProblem: PostProcessingSolverParams) {
    super()
    this.postProcessingSolver = new PostProcessingSolver(inputProblem)
    this.MAX_ITERATIONS = this.postProcessingSolver.MAX_ITERATIONS + 1
  }

  override getSolverName(): string {
    return "SafePostProcessingSolver"
  }

  override _step(): void {
    try {
      this.postProcessingSolver.step()
    } catch (error) {
      if (!(error instanceof DifferentialPairRoutingError)) throw error
      this.usedFallback = true
      this.solved = true
      this.progress = 1
      this.stats = {
        phase: "fallback",
        reason: error.reason,
        pair: error.connectionNames.join("/"),
      }
      return
    }

    this.progress = this.postProcessingSolver.progress
    this.stats = this.postProcessingSolver.stats
    if (this.postProcessingSolver.solved) {
      this.solved = true
      return
    }
    if (this.postProcessingSolver.failed) {
      this.error = this.postProcessingSolver.error
      this.failed = true
    }
  }

  override getConstructorParams(): [PostProcessingSolverParams] {
    return [this.inputProblem]
  }

  getOutput(): PostProcessingSolverOutput {
    if (!this.solved)
      throw new Error(
        "SafePostProcessingSolver: getOutput() called before completion",
      )
    if (this.usedFallback)
      return { hdRoutes: structuredClone(this.inputProblem.hdRoutes) }
    return this.postProcessingSolver.getOutput()
  }

  override visualize(): GraphicsObject {
    return this.postProcessingSolver.visualize()
  }
}
