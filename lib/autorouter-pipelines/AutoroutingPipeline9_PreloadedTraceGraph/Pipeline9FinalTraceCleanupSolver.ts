import type { GraphicsObject } from "graphics-debug"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getOctilinearCleanupCandidates } from "./getOctilinearCleanupCandidates"

type FinalCleanupInput = {
  srj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  traces: SimplifiedPcbTraces
  fixedTraces: SimplifiedPcbTraces
  connectionNames: readonly string[]
}

/** Cleans expanded power routes at their final width without moving other copper. */
export class Pipeline9FinalTraceCleanupSolver extends BaseSolver {
  private output: SimplifiedPcbTraces
  private traceIndex = 0
  private candidates?: Generator<SimplifiedPcbTrace>
  private readonly selectedNames: Set<string>

  constructor(private readonly input: FinalCleanupInput) {
    super()
    this.output = [...input.traces]
    this.selectedNames = new Set(input.connectionNames)
    this.MAX_ITERATIONS = 100e6
    // Cosmetic cleanup requires a DRC-clean input; repair belongs upstream.
    this.solved = this.selectedNames.size === 0 || !this.isValid(this.output)
  }

  override _step(): void {
    const trace = this.output[this.traceIndex]
    if (!trace) {
      this.solved = true
      return
    }
    if (!this.selectedNames.has(trace.connection_name)) {
      this.traceIndex++
      return
    }
    this.candidates ??= getOctilinearCleanupCandidates(
      trace,
      this.input.traces[this.traceIndex]!,
    )
    const next = this.candidates.next()
    if (next.done) {
      this.candidates = undefined
      this.traceIndex++
      return
    }
    const candidate = [...this.output]
    candidate[this.traceIndex] = next.value
    if (this.isValid(candidate)) {
      this.output = candidate
      this.candidates = undefined
    }
  }

  private isValid(traces: SimplifiedPcbTraces): boolean {
    return (
      evaluateRelaxedDrc({
        inputSrj: { ...this.input.srj, traces: this.input.fixedTraces },
        srjWithPointPairs: this.input.srjWithPointPairs,
        routedTraces: traces,
        includeBoardClearance: true,
        drcOptions: {
          traceClearance: this.input.srj.minTraceToPadEdgeClearance ?? 0.1,
          viaClearance:
            this.input.srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
        },
      }).errors.length === 0
    )
  }

  override visualize(): GraphicsObject {
    return convertSrjToGraphicsObject(
      {
        ...this.input.srj,
        traces: [...this.input.fixedTraces, ...this.output],
      },
      { traceColorMode: "layer" },
    )
  }

  getOutput(): SimplifiedPcbTraces {
    if (!this.solved) throw new Error("Final cleanup is not complete")
    return this.output
  }
}
