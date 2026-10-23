import {
  HighDensitySolverA01,
  HighDensitySolverA03,
} from "@tscircuit/high-density-a01"

const deferredNativeGrids = new WeakSet<object>()

export const hasDeferredNativeGridSetup = (solver: unknown): boolean => {
  if (typeof solver !== "object" || solver === null) {
    return false
  }
  return deferredNativeGrids.has(solver)
}

export type NativeGridSetupDiagnostics = {
  deferredCandidateCount: number
  deferredPlaneCellCount: number
  deferredLayerCellCount: number
  materializationAttemptCount: number
  materializedCandidateCount: number
  materializedPlaneCellCount: number
  materializedLayerCellCount: number
  selectedCandidateCount: number
  eagerCandidateCount: number
  eagerPlaneCellCount: number
  eagerLayerCellCount: number
}

export const createNativeGridSetupDiagnostics = (): NativeGridSetupDiagnostics => ({
  deferredCandidateCount: 0,
  deferredPlaneCellCount: 0,
  deferredLayerCellCount: 0,
  materializationAttemptCount: 0,
  materializedCandidateCount: 0,
  materializedPlaneCellCount: 0,
  materializedLayerCellCount: 0,
  selectedCandidateCount: 0,
  eagerCandidateCount: 0,
  eagerPlaneCellCount: 0,
  eagerLayerCellCount: 0,
})

/**
 * The installed A01/A03 (0.0.36) start with a 100m requested limit. Their
 * computeMaxIterationsByNodeSizeAndConnectionCount clamps 20% of that request
 * to a 2m minimum, before taking the requested limit. Thus any portfolio cap
 * at or below 2m is exactly known without allocating the native grid.
 *
 * Only setup is delayed. The original instance, search implementation, base
 * search budget, candidate ordering and supervisor work clock are retained.
 */
export const deferNativeGridSetup = (
  solver: HighDensitySolverA01 | HighDensitySolverA03,
  iterationLimit: number,
  diagnostics: NativeGridSetupDiagnostics,
): boolean => {
  const node = solver.nodeWithPortPoints
  const nativePrototype = Object.getPrototypeOf(solver)
  if (
    (nativePrototype !== HighDensitySolverA01.prototype && nativePrototype !== HighDensitySolverA03.prototype) ||
    !Number.isFinite(iterationLimit) ||
    iterationLimit <= 0 ||
    iterationLimit > 2_000_000 ||
    solver.MAX_ITERATIONS !== 100_000_000 ||
    solver.maxCellCount !== undefined ||
    solver.initialPenaltyFn !== undefined ||
    !Number.isFinite(node.width) ||
    !Number.isFinite(node.height) ||
    node.width < 0 ||
    node.height < 0 ||
    !Number.isFinite(node.center.x) ||
    !Number.isFinite(node.center.y) ||
    !node.portPoints.every(
      (point) => typeof point.connectionName === "string" && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
    ) ||
    (node.availableZ != null && (!Array.isArray(node.availableZ) || !node.availableZ.every(Number.isFinite)))
  ) {
    return false
  }
  if (solver instanceof HighDensitySolverA01) {
    if (!Number.isFinite(solver.cellSizeMm) || solver.cellSizeMm <= 0) return false
  } else {
    const scale = solver.lowResolutionCellSize / solver.highResolutionCellSize
    if (
      !Number.isFinite(solver.highResolutionCellSize) ||
      solver.highResolutionCellSize <= 0 ||
      !Number.isFinite(scale) ||
      scale <= 0 ||
      Math.abs(scale - Math.round(scale)) > 1e-9
    ) {
      return false
    }
  }
  const cellSize = solver instanceof HighDensitySolverA01 ? solver.cellSizeMm : solver.highResolutionCellSize
  const rows = Math.max(1, Math.ceil(node.height / cellSize))
  const cols = Math.max(1, Math.ceil(node.width / cellSize))
  const layerCount = node.availableZ?.length ?? new Set(node.portPoints.map((point) => point.z)).size
  // Malformed or unrepresentable allocation domains retain native eager
  // setup, including its original errors. This upper bound also covers A03's
  // coarser interior and A01's two diagonal slots per grid square.
  const maximumArrayLength = rows * cols * Math.max(1, layerCount) * 2
  if (!Number.isSafeInteger(maximumArrayLength) || maximumArrayLength > 0x7fffffff) return false
  let planeCells: number
  if (solver instanceof HighDensitySolverA01) {
    planeCells = Math.floor(node.height / cellSize) * Math.floor(node.width / cellSize)
  } else {
    const bandRows = Math.min(solver.highResolutionCellThickness, Math.floor(rows / 2))
    const bandCols = Math.min(solver.highResolutionCellThickness, Math.floor(cols / 2))
    const middleRows = Math.max(0, rows - 2 * bandRows)
    const middleCols = Math.max(0, cols - 2 * bandCols)
    const scale = Math.max(1, Math.round(solver.lowResolutionCellSize / cellSize))
    planeCells = 2 * rows * bandCols + 2 * bandRows * middleCols + Math.ceil(middleRows / scale) * Math.ceil(middleCols / scale)
  }

  const requestedLimit = solver.MAX_ITERATIONS
  const nativeSetup = solver._setup
  let materializing = false
  solver.MAX_ITERATIONS = iterationLimit
  solver._setup = function (): void {
    // Keep an explicit later caller budget adjustment, just as an already
    // initialized candidate would. Native setup still receives its original
    // request so its per-connection baseSearchBudgetIters is identical.
    const selectedLimit = this.MAX_ITERATIONS
    this.MAX_ITERATIONS = requestedLimit
    diagnostics.materializationAttemptCount++
    materializing = true
    try {
      nativeSetup.call(this)
    } finally {
      materializing = false
    }
    this.MAX_ITERATIONS = selectedLimit
    deferredNativeGrids.delete(this)
    diagnostics.materializedCandidateCount++
    // BaseSolver.setup marks _setupDone only after this method returns.
    const stats = nativeGridStats.call(this)
    diagnostics.materializedPlaneCellCount += stats.cells
    diagnostics.materializedLayerCellCount += stats.states
  }
  const nativeGridStats = Object.getOwnPropertyDescriptor(nativePrototype, "gridStats")!.get!
  for (const key of ["gridStats", "solvedConnectionsMap", "unsolvedConnections", "activeConnection", "openSet"]) {
    const nativeGetter = Object.getOwnPropertyDescriptor(nativePrototype, key)?.get
    if (!nativeGetter) continue
    Object.defineProperty(solver, key, {
      configurable: true,
      get(this: HighDensitySolverA01 | HighDensitySolverA03): unknown {
        if (!materializing) {
          this.setup()
        }
        return nativeGetter.call(this)
      },
    })
  }
  const nativeVisualize = solver.visualize
  solver.visualize = function () {
    if (hasDeferredNativeGridSetup(this)) {
      this.setup()
    }
    return nativeVisualize.call(this)
  }
  const nativeGetOutput = solver.getOutput
  solver.getOutput = function () {
    if (hasDeferredNativeGridSetup(this)) {
      this.setup()
    }
    return nativeGetOutput.call(this)
  }
  diagnostics.deferredCandidateCount++
  deferredNativeGrids.add(solver)
  diagnostics.deferredPlaneCellCount += planeCells
  diagnostics.deferredLayerCellCount += planeCells * layerCount
  return true
}
