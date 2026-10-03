import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { combineVisualizations } from "../../utils/combineVisualizations"
import { convertSrjToGraphicsObject } from "../../utils/convertSrjToGraphicsObject"
import {
  PostRoutingOptimizationTransaction,
  type PostRoutingOptimizationResult,
} from "./optimizePostRouting"

/** Candidate validation and atomic acceptance/rollback; never re-routes. */
export class PostRoutingOptimizationSolver extends BaseSolver {
  private output?: PostRoutingOptimizationResult
  private readonly candidateGraphics: GraphicsObject

  constructor(
    private readonly transaction: PostRoutingOptimizationTransaction,
  ) {
    super()
    this.candidateGraphics = this.visualize()
  }

  override _step(): void {
    this.output = this.transaction.evaluate()
    this.stats = {
      status: this.output.status,
      validationStatus: this.output.validationStatus,
      changedNets: this.output.changedNets,
      before: this.output.before,
      after: this.output.after,
      diagnostics: this.output.diagnostics,
    }
    this.solved = true
    this.progress = 1
  }

  override getConstructorParams(): [PostRoutingOptimizationTransaction] {
    return [this.transaction]
  }

  override getOutput(): PostRoutingOptimizationResult {
    if (!this.output)
      throw new Error("PostRoutingOptimizationSolver: validation not completed")
    return structuredClone(this.output)
  }

  override visualize(): GraphicsObject {
    const input = this.transaction.getInput()
    const traces = this.output
      ? this.output.traces
      : this.transaction.getSnapshot().traces
    const graphics: GraphicsObject = convertSrjToGraphicsObject(
      { ...input.srj, traces },
      { traceColorMode: "net" },
    )
    graphics.texts = [
      {
        x: input.srj.bounds.minX,
        y: input.srj.bounds.maxY + 0.5,
        fontSize: 0.35,
        anchorSide: "bottom_left",
        text: this.output
          ? `${this.output.status === "unsupported" ? "Unsupported input; copper preserved, validation incomplete" : this.output.status === "accepted" ? "Accepted" : "Atomic rollback"}: ${this.output.changedNets.join(", ") || this.output.diagnostics.join("; ") || this.output.status}`
          : "Candidate awaiting whole-board validation",
      },
    ]
    return graphics
  }

  getRecordedGraphics(): GraphicsObject {
    return combineVisualizations(...[this.candidateGraphics, this.visualize()])
  }

  override preview(): GraphicsObject {
    return this.visualize()
  }
}
