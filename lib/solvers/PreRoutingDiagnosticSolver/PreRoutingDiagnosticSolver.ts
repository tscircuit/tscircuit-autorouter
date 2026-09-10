import type { GraphicsObject } from "graphics-debug"
import { getPreRoutingDiagnostics } from "lib/diagnostics/getPreRoutingDiagnostics"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "lib/types"

export class PreRoutingDiagnosticSolver extends BaseSolver {
  constructor(public readonly inputSrj: SimpleRouteJson) {
    super()
    this.MAX_ITERATIONS = 1
  }

  override getSolverName(): string {
    return "PreRoutingDiagnosticSolver"
  }

  override _step() {
    const diagnostics = getPreRoutingDiagnostics(this.inputSrj)
    for (const diag of diagnostics) {
      this.emitDiagnostic?.({
        ...diag,
        phase: "pre_routing",
      })
    }

    const blockingDiagnostic = (this.diagnostics ?? []).find(
      (d) => d.severity === "error" && d.recommendedAction === "stop_and_fix",
    )

    if (blockingDiagnostic) {
      this.failed = true
      this.error = `[${blockingDiagnostic.code}] ${blockingDiagnostic.message}`
      return
    }

    this.solved = true
  }

  override getConstructorParams() {
    return [this.inputSrj] as const
  }

  override visualize(): GraphicsObject {
    return { lines: [], points: [], rects: [], circles: [] }
  }
}
