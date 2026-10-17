import { BaseSolver } from "lib/solvers/BaseSolver"
import type { Pipeline9RepairRuntime, Pipeline9NegotiationTask, NegotiationInput, NegotiationResult } from "./pipeline9NegotiationTask"

/** Searches a fixed portfolio and selects by geometry, never by finish time. */
export class ParallelPipeline9NegotiationSolver extends BaseSolver {
  private output?: NegotiationResult

  constructor(readonly input: NegotiationInput, readonly runtime: Pipeline9RepairRuntime) {
    super()
    if (!Number.isSafeInteger(runtime.workerCount) || runtime.workerCount < 1) {
      throw new Error("Negotiation worker count must be a positive integer")
    }
  }

  override _step(): void {
    const { isLocked, onSearch, ...input } = this.input
    const lockedPointIndices = input.routes.map((route, ri): boolean[] =>
      route.route.map((_, pi): boolean => isLocked(ri, pi)))
    const weights = [3, 2, 4, 5, 6, 8, 10, 12]
    const tasks: Pipeline9NegotiationTask[] = Array.from({ length: this.runtime.workerCount }, (_, index) => ({
      ...input,
      lockedPointIndices,
      pathHeuristicWeight: weights[index % weights.length]!,
      pathGridSizeScale: index === 0 ? input.pathGridSizeScale : 3,
      maxPathSearchCalls: Math.floor(input.maxPathSearchCalls / this.runtime.workerCount),
      maxPathSearchNodes: Math.floor(input.maxPathSearchNodes / this.runtime.workerCount),
    }))
    const results = this.runtime.runNegotiations(tasks)
    if (results.length !== tasks.length) throw new Error("Negotiation runtime returned an incomplete portfolio")
    let selected = results[0]!
    let length = Infinity
    for (const result of results) {
      let candidateLength = 0
      for (const route of result.routes) {
        for (let i = 1; i < route.route.length; i++) {
          const a = route.route[i - 1]!, b = route.route[i]!
          candidateLength += Math.hypot(a.x - b.x, a.y - b.y)
        }
      }
      if (result.unresolvedSpanCount < selected.unresolvedSpanCount ||
        (result.unresolvedSpanCount === selected.unresolvedSpanCount && candidateLength < length)) {
        selected = result
        length = candidateLength
      }
    }
    this.output = {
      ...selected,
      pathSearchCalls: results.reduce((sum, result): number => sum + result.pathSearchCalls, 0),
      pathSearchNodes: results.reduce((sum, result): number => sum + result.pathSearchNodes, 0),
    }
    this.stats = { workerCount: this.runtime.workerCount, unresolvedSpanCount: selected.unresolvedSpanCount }
    this.solved = true
  }

  getOutput(): NegotiationResult {
    if (!this.output) throw new Error("Parallel negotiation is not complete")
    return this.output
  }
}
