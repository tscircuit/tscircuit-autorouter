/** Construct one head and stem per detected V; no routes change in this stage. */
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type {
  ConstructPadTsInput,
  PadTConstructionResult,
} from "./padJunctionTypes"
import { constructPadT } from "./constructPadT"
import { visualizePadT } from "./visualizePadT"

export class ConstructPadTsSolver extends BaseSolver {
  private readonly ts: PadTConstructionResult[] = []
  private index = 0
  current: PadTConstructionResult | undefined
  constructor(private readonly input: ConstructPadTsInput) {
    super()
    this.MAX_ITERATIONS = input.vs.length + 1
  }
  override _step(): void {
    // Forward unsupported pairs without spending a debugger step on each one.
    while (this.index < this.input.vs.length) {
      const entry = this.input.vs[this.index++]!
      const result = entry.result
      if ("outcome" in result) {
        this.ts.push({ ...entry, result })
        continue
      }
      this.current = {
        ...entry,
        result: constructPadT(this.input.context, result),
      }
      this.ts.push(this.current)
      break
    }
    this.stats = { terminalPairs: this.index }
    if (this.index === this.input.vs.length) this.solved = true
  }
  override getConstructorParams(): [ConstructPadTsInput] {
    return [this.input]
  }
  override getOutput(): PadTConstructionResult[] {
    if (!this.solved)
      throw new Error(
        "ConstructPadTsSolver: output requested before completion",
      )
    return this.ts
  }
  override visualize(): GraphicsObject {
    return visualizePadT(
      this.input.context,
      this.input.context.input.hdRoutes,
      this.current,
      "Proposed T",
    )
  }
}
