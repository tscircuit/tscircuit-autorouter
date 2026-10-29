import {
  MultiSimplifiedPathSolver,
  TraceSimplificationSolver,
} from "@tscircuit/trace-simplification-solver"
import { Pipeline9LayerPreservingPathSolver } from "./Pipeline9LayerPreservingPathSolver"

/** Preserves physical layer boundaries while retaining every simplification phase. */
export class Pipeline9TraceSimplificationSolver extends TraceSimplificationSolver {
  override _step(): void {
    super._step()
    const child = this.activeSubSolver
    if (
      this.currentPhase !== "path_simplification" ||
      !(child instanceof MultiSimplifiedPathSolver) ||
      child instanceof Pipeline9LayerPreservingPathSolver
    )
      return
    if (child.iterations !== 0)
      throw new Error(
        "Pipeline9 path simplification started before its layer sections were prepared",
      )
    this.activeSubSolver = new Pipeline9LayerPreservingPathSolver({
      unsimplifiedHdRoutes: child.unsimplifiedHdRoutes,
      otherHdRoutes: child.otherHdRoutes,
      obstacles: child.obstacles,
      connMap: child.connMap,
      colorMap: child.colorMap,
      outline: child.outline,
      minBoardEdgeClearance: child.minBoardEdgeClearance,
      defaultViaDiameter: child.defaultViaDiameter,
      useTraceWidthAwareClearance: child.useTraceWidthAwareClearance,
      enableVertexShortcuts: child.enableVertexShortcuts,
    })
  }
}
