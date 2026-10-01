import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { combineVisualizations } from "../../utils/combineVisualizations"
import { convertSrjToGraphicsObject } from "../../utils/convertSrjToGraphicsObject"
import {
  PostRoutingOptimizationTransaction,
  type PostRoutingOptimizationInput,
  type PostRoutingOptimizationOptions,
} from "./optimizePostRouting"

/** Proposes branches incrementally; completed proposals still require the gate. */
export class PostRoutingNetTreeSolver extends BaseSolver {
  private readonly transaction: PostRoutingOptimizationTransaction
  private readonly frames: GraphicsObject[] = []
  private readonly options: PostRoutingOptimizationOptions

  constructor(
    input: PostRoutingOptimizationInput,
    options: PostRoutingOptimizationOptions,
  ) {
    super()
    this.transaction = new PostRoutingOptimizationTransaction(input, options)
    this.options = {
      ...structuredClone({
        enabled: options.enabled,
        nets: options.nets,
        objective: options.objective,
        search: options.search,
      }),
      validate: options.validate,
    }
    this.MAX_ITERATIONS = input.srj.connections.reduce(
      (count, c) => count + c.pointsToConnect.length,
      input.traces.length + 100,
    )
    this.frames.push(this.visualize())
  }

  override _step(): void {
    this.solved = this.transaction.advanceProposal()
    const snapshot = this.transaction.getSnapshot()
    this.stats = snapshot.event
      ? { ...snapshot.event, traces: undefined }
      : { proposalComplete: this.solved }
    this.frames.push(this.visualize())
    this.progress = this.solved ? 1 : 0
  }

  override getOutput(): PostRoutingOptimizationTransaction {
    if (!this.solved)
      throw new Error(
        "PostRoutingNetTreeSolver: proposal requested before completion",
      )
    return this.transaction
  }

  override getConstructorParams(): [
    PostRoutingOptimizationInput,
    PostRoutingOptimizationOptions,
  ] {
    return [this.transaction.getInput(), this.options]
  }

  override visualize(): GraphicsObject {
    const input = this.transaction.getInput(),
      snapshot = this.transaction.getSnapshot()
    const graphics: GraphicsObject = convertSrjToGraphicsObject(
      { ...input.srj, traces: snapshot.traces },
      { traceColorMode: "net" },
    )
    const event = snapshot.event
    graphics.texts = [
      {
        x: input.srj.bounds.minX,
        y: input.srj.bounds.maxY + 0.5,
        fontSize: 0.35,
        anchorSide: "bottom_left",
        text: event
          ? `${event.net}: ${event.kind} branch ${event.branches}; ${event.components} components; ${event.insertedVias} vias`
          : this.solved
            ? "Proposal complete; awaiting validation"
            : "Original completed routing",
      },
    ]
    return graphics
  }

  getRecordedGraphics(): GraphicsObject {
    return combineVisualizations(...this.frames)
  }

  override preview(): GraphicsObject {
    return this.visualize()
  }
}
