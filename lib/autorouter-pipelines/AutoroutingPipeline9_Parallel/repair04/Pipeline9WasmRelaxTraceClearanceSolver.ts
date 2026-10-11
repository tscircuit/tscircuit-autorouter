import type { RelaxTraceClearanceInput } from "@tscircuit/repair04"
import type { HighDensityRoute } from "high-density-repair03/lib"
import type { Bounds } from "./repair04Helpers"
import {
  getRepairJunctionAnchors,
  type JunctionPreparationDiagnostics,
  type RepairJunctionAnchors,
} from "./getRepairJunctionAnchors"
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

  readonly junctionPreparationDiagnostics: JunctionPreparationDiagnostics = {
    usedEndpointComponentProof: false,
    canonicalNetCount: 0,
  }

  protected override createJunctionAnchors(
    srj: RelaxTraceClearanceInput["srj"],
    routes: HighDensityRoute[],
    bounds: Bounds,
  ): RepairJunctionAnchors[] {
    return getRepairJunctionAnchors(srj, routes, bounds, {
      skipProvenSingleEndpointComponents: true,
      diagnostics: this.junctionPreparationDiagnostics,
    })
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
