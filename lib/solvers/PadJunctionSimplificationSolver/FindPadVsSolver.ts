/** Find V runs by indexed net, then pad membership and cardinal geometry. */
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { Pad } from "./parsePadJunctionInput"
import type { PadJunctionContext, PadVSearchResult } from "./padJunctionTypes"
import { findPadTerminals } from "./findPadTerminals"
import { detectPadV } from "./detectPadV"
import { visualizePadV } from "./visualizePadV"

export class FindPadVsSolver extends BaseSolver {
  private readonly vs: PadVSearchResult[] = []
  private padIndex = 0
  activePad: Pad | undefined
  current: PadVSearchResult | undefined
  constructor(private readonly context: PadJunctionContext) {
    super()
    this.MAX_ITERATIONS = context.pads.length + 1
  }
  override _step(): void {
    const pad = this.context.pads[this.padIndex++]
    this.activePad = pad
    this.current = undefined
    if (!pad) {
      this.solved = true
      return
    }
    const terminals = findPadTerminals(this.context, pad)
    if (terminals) {
      this.current = {
        pad,
        terminals,
        result: detectPadV(this.context, pad, terminals),
      }
      this.vs.push(this.current)
    }
    this.stats = { padsVisited: this.padIndex, terminalPairs: this.vs.length }
    if (this.padIndex === this.context.pads.length) this.solved = true
  }
  override getConstructorParams(): [PadJunctionContext] {
    return [this.context]
  }
  override getOutput(): PadVSearchResult[] {
    if (!this.solved)
      throw new Error("FindPadVsSolver: output requested before completion")
    return this.vs
  }
  override visualize(): GraphicsObject {
    return visualizePadV(this.context, this.activePad, this.current)
  }
}
