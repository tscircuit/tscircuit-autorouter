import type { NodeWithPortPoints } from "../types/high-density-types"

type ProfiledSolver = {
  getSolverName(): string
  solved: boolean
  failed: boolean
  iterations: number
  MAX_ITERATIONS: number
  progress: number
  error: string | null
  nodeWithPortPoints?: NodeWithPortPoints
  solvedConnectionsMap?: ReadonlyMap<unknown, readonly unknown[]>
  growthAttempts?: number
  rejectionReason?: string | null
  winningSolver?: ProfiledSolver
}

export type SolverProfileRecord = {
  name: string
  success: boolean
  outcome: "running" | "solved" | "failed" | "rejected"
  timeMs: number
  iterations: number
  maxIterations: number
  progress: number
  solvedSegmentCount?: number
  nodeId?: string
  nodeWithPortPoints?: NodeWithPortPoints
  growthAttempts?: number
  error: string | null
  rejectionReason?: string | null
  selected: boolean
}

/** Optional measurement of actual step work, including unfinished candidates. */
export class SolverProfiler {
  static active: SolverProfiler | null = null
  readonly records: SolverProfileRecord[] = []
  private recordsBySolver = new WeakMap<ProfiledSolver, SolverProfileRecord>()

  constructor(private readonly solverNames?: ReadonlySet<string>) {}

  recordStep(solver: ProfiledSolver, timeMs: number): void {
    if (solver.winningSolver) {
      const winner = this.recordsBySolver.get(solver.winningSolver)
      if (winner) winner.selected = true
    }
    if (this.solverNames && !this.solverNames.has(solver.getSolverName())) return
    let record = this.recordsBySolver.get(solver)
    if (!record) {
      record = {
        name: solver.getSolverName(),
        success: false,
        outcome: "running",
        timeMs: 0,
        iterations: 0,
        maxIterations: solver.MAX_ITERATIONS,
        progress: 0,
        error: null,
        selected: false,
      }
      this.recordsBySolver.set(solver, record)
      this.records.push(record)
    }
    record.timeMs += timeMs
    record.success = solver.solved && !solver.failed
    record.outcome = solver.rejectionReason
      ? "rejected"
      : solver.failed
        ? "failed"
        : solver.solved
          ? "solved"
          : "running"
    record.iterations = solver.iterations
    record.maxIterations = solver.MAX_ITERATIONS
    record.progress = solver.progress
    record.error = solver.error
    record.nodeId = solver.nodeWithPortPoints?.capacityMeshNodeId
    if (record.name === "HighDensitySolverA11") {
      record.nodeWithPortPoints = solver.nodeWithPortPoints
    }
    record.growthAttempts = solver.growthAttempts
    record.rejectionReason = solver.rejectionReason
    if (solver.solvedConnectionsMap) {
      record.solvedSegmentCount = 0
      for (const routes of solver.solvedConnectionsMap.values()) {
        record.solvedSegmentCount += routes.length
      }
    }
  }
}
