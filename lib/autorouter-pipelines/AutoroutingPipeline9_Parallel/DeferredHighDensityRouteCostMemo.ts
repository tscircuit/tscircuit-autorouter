import type { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "../../solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { createHighDensityRouteCostMemo, type HighDensityRouteCostMemo } from "./HighDensityRouteCostMemo"

const MINIMUM_NATIVE_COST_CALLS = 512

/** Short routes keep native math and allocate no scalar memo workspace. */
export class DeferredHighDensityRouteCostMemo {
  private memo: HighDensityRouteCostMemo | null = null
  private nativeCostCalls = 0

  constructor(
    private readonly solver: SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
    private readonly minimumNativeCostCalls = MINIMUM_NATIVE_COST_CALLS,
  ) {
    if (!Number.isSafeInteger(minimumNativeCostCalls) || minimumNativeCostCalls < 0) {
      throw new Error("HD cost memo activation requires a nonnegative native-call count")
    }
    // Zero is used by the eager-cache mutation oracle, never by production.
    if (minimumNativeCostCalls === 0) this.memo = createHighDensityRouteCostMemo(solver)
  }

  beginNeighborBatch(): HighDensityRouteCostMemo | null {
    // Activate only between complete batches. The original route and closest
    // selector cache continue uninterrupted; this changes scalar math storage.
    if (!this.memo && this.nativeCostCalls >= this.minimumNativeCostCalls) {
      this.memo = createHighDensityRouteCostMemo(this.solver)
    }
    this.memo?.beginNeighborBatch()
    return this.memo
  }

  endNeighborBatch(completedNativeCostCalls: number): void {
    this.nativeCostCalls = Math.min(this.minimumNativeCostCalls,
      this.nativeCostCalls + completedNativeCostCalls)
    this.memo?.endNeighborBatch()
  }
}
