/** Validate and apply in pad order, checking each T against earlier replacements. */
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type {
  ApplyPadTsInput,
  PadTConstructionResult,
  PadJunctionOutcome,
  AcceptedReplacement,
} from "./padJunctionTypes"
import { checkPadTClearance } from "./checkPadTClearance"
import { applyPadT } from "./applyPadT"
import { visualizePadT } from "./visualizePadT"

export class ApplyPadTsSolver extends BaseSolver {
  readonly outcomes: PadJunctionOutcome[] = []
  acceptedReplacement: AcceptedReplacement | null = null
  private index = 0
  current: PadTConstructionResult | undefined
  constructor(private readonly input: ApplyPadTsInput) {
    super()
    this.MAX_ITERATIONS = input.ts.length + 1
  }
  override _step(): void {
    const { context } = this.input
    while (this.index < this.input.ts.length) {
      const entry = this.input.ts[this.index++]!
      if ("outcome" in entry.result && entry.result.outcome === "unsupported") {
        this.outcomes.push(entry.result)
        continue
      }
      this.current = entry
      // Earlier accepted pads own their routes. This also rejects stale proposals
      // constructed for the opposite end of one of those routes.
      let outcome: PadJunctionOutcome
      if (
        entry.terminals.some(({ routeIndex }) =>
          context.lockedRoutes.has(routeIndex),
        )
      ) {
        outcome = {
          outcome: "unsupported",
          reason:
            "Requires two straight runs forming a V around a cardinal stem",
          connectionNames: entry.terminals.map(
            ({ routeIndex }) => context.output[routeIndex]!.connectionName,
          ),
        }
      } else if ("outcome" in entry.result) {
        outcome = entry.result
      } else {
        const t = entry.result
        const blocked = checkPadTClearance(context, t)
        if (blocked)
          outcome = {
            outcome: "no_path",
            reason: blocked,
            connectionNames: t.v.connectionNames,
          }
        else {
          outcome = applyPadT(context, t)
          this.acceptedReplacement = t.replacement
        }
      }
      if (outcome.outcome !== "accepted")
        this.current = { ...entry, result: outcome }
      this.outcomes.push(outcome)
      break
    }
    this.stats = { replacements: context.lockedRoutes.size / 2 }
    if (this.index === this.input.ts.length) this.solved = true
  }
  override getConstructorParams(): [ApplyPadTsInput] {
    return [this.input]
  }
  override getOutput(): HighDensityRoute[] {
    if (!this.solved)
      throw new Error("ApplyPadTsSolver: output requested before completion")
    return this.input.context.output
  }
  override visualize(): GraphicsObject {
    let status = "Check clearance"
    if (this.current) {
      status = "Replaced V with a straight head and perpendicular stem"
      if ("outcome" in this.current.result) status = this.current.result.reason
    }
    return visualizePadT(
      this.input.context,
      this.input.context.output,
      this.current,
      status,
    )
  }
}
