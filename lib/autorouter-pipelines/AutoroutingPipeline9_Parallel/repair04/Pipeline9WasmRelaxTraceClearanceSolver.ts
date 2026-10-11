import {
  Pipeline9IndexedRelaxTraceClearanceSolver,
  type ProjectionBatchExecutor,
  type ProjectionSweepGeometry,
} from "./Pipeline9IndexedRelaxTraceClearanceSolver"
import {
  createProjectionWasmKernel,
  type ProjectionKernelDiagnostics,
} from "./projectionWasm/createProjectionWasmKernel"

/** Retains native preparation, physical guards, budgets and publication order. */
export class Pipeline9WasmRelaxTraceClearanceSolver extends Pipeline9IndexedRelaxTraceClearanceSolver {
  readonly kernelDiagnostics: ProjectionKernelDiagnostics = {
    enabled: false,
    batches: 0,
    guardCalls: 0,
  }

  protected override createProjectionBatchExecutor(
    geometry: ProjectionSweepGeometry,
  ): ProjectionBatchExecutor | undefined {
    if (!this.hasNativeProjectVertexHook()) {
      this.kernelDiagnostics.fallbackReason = "custom native projectVertex hook"
      return undefined
    }
    return createProjectionWasmKernel(geometry, this.kernelDiagnostics)
  }
}
