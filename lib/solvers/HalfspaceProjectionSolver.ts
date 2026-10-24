import { BaseSolver } from "./BaseSolver"
import { getOppositeRowCertificate, type OppositeRowCertificate, type OppositeRowCheckStats } from "./getOppositeRowCertificate"

export type LinearHalfspace = {
  terms: { variable: number; coefficient: number }[]
  maximum: number
  family?: number
}

export type HalfspaceProjectionResult =
  | { status: "feasible"; values: number[] }
  | { status: "contradictory-choice"; certificate: OppositeRowCertificate }
  | {
      status: "unknown"
      reason: "work-cap" | "sweep-cap" | "numerical" | "constant-constraint"
      residualFamilies: number[]
    }

/**
 * Hildreth dual coordinate updates for projection of zero onto half-spaces.
 * A finite feasible witness is checked before acceptance. Nonconvergence has
 * no infeasibility meaning, and no dual iterate is exported as a hard clause.
 */
export class HalfspaceProjectionSolver extends BaseSolver {
  readonly constraints: readonly LinearHalfspace[]
  readonly variableCount: number
  readonly workCap: number
  readonly sweepCap: number
  private point: Float64Array
  private dual: Float64Array
  private norms: Float64Array
  private phase: "preprocess" | "update" | "verify" = "preprocess"
  private normalRows = new Map<string, number>()
  readonly proofStats: OppositeRowCheckStats = { rowChecks: 0, termReads: 0, termComparisons: 0, sortComparisons: 0 }
  private row = 0
  private sweeps = 0
  private violations = 0
  private residuals = new Map<number, number>()
  private allFamilies = new Set<number>()
  private result?: HalfspaceProjectionResult
  constraintChecks = 0

  constructor(
    variableCount: number, constraints: readonly LinearHalfspace[],
    workCap: number, sweepCap = 64,
  ) {
    super()
    if (
      !Number.isSafeInteger(variableCount) || variableCount < 1 ||
      !Number.isSafeInteger(workCap) || workCap < 0 ||
      !Number.isSafeInteger(sweepCap) || sweepCap < 1
    ) throw new Error("Half-space projection requires finite positive dimensions and bounded work")
    this.constraints = constraints
    this.variableCount = variableCount
    this.workCap = workCap
    this.sweepCap = sweepCap
    this.point = new Float64Array(variableCount)
    this.dual = new Float64Array(constraints.length)
    this.norms = new Float64Array(constraints.length)
    let coefficientEntries = 0
    for (let index = 0; index < constraints.length; index++) {
      const constraint = constraints[index]!
      if (!Number.isFinite(constraint.maximum)) throw new Error("Nonfinite half-space bound")
      if (constraint.family !== undefined && (!Number.isSafeInteger(constraint.family) || constraint.family < 0)) {
        throw new Error("Half-space family identity must be a nonnegative finite integer")
      }
      const seen = new Set<number>()
      for (const term of constraint.terms) {
        if (
          !Number.isSafeInteger(term.variable) || term.variable < 0 ||
          term.variable >= variableCount || !Number.isFinite(term.coefficient) ||
          seen.has(term.variable)
        ) throw new Error("Half-space terms require distinct finite variable coefficients")
        seen.add(term.variable)
        this.norms[index] = this.norms[index]! + term.coefficient * term.coefficient
        coefficientEntries++
      }
      if (!Number.isFinite(this.norms[index])) throw new Error("Half-space normal overflow")
      if (constraint.family !== undefined) this.allFamilies.add(constraint.family)
    }
    this.MAX_ITERATIONS = Math.ceil((workCap + constraints.length) / 4096) + 4
    this.stats = { rowUpdates: 0, residualChecks: 0, coefficientEntries, sweeps: 0, preprocessingRows: 0, canonicalizedTerms: 0, hashProbes: 0, hashKeyCharacters: 0, canonicalSortComparisons: 0 }
  }

  private stopUnknown(reason: Extract<HalfspaceProjectionResult, { status: "unknown" }>["reason"]): void {
    // Residual families select possible next finite side assignments only.
    // They are not an unsatisfiable core, even after a full sweep.
    const families = this.residuals.size > 0
      ? [...this.residuals].sort((a, b): number => b[1] - a[1]).map(([family]): number => family)
      : [...this.allFamilies]
    this.result = { status: "unknown", reason, residualFamilies: families }
  }

  private preprocessRow(): void {
    if (this.row === this.constraints.length) {
      this.normalRows.clear()
      this.row = 0
      this.phase = "update"
      return
    }
    const index = this.row++
    const row = this.constraints[index]!
    const terms = row.terms.filter((term): boolean => term.coefficient !== 0)
      .sort((a, b): number => {
        this.stats.canonicalSortComparisons++
        return a.variable - b.variable
      })
    this.stats.preprocessingRows++
    this.stats.canonicalizedTerms += row.terms.length
    const key = JSON.stringify(terms.map((term): [number, number] => [term.variable, term.coefficient]))
    const opposite = JSON.stringify(terms.map((term): [number, number] => [term.variable, -term.coefficient]))
    this.stats.hashProbes++
    this.stats.hashKeyCharacters += key.length + opposite.length
    const previous = this.normalRows.get(opposite)
    if (previous !== undefined) {
      const certificate = getOppositeRowCertificate(this.constraints, previous, index, 1e-10, this.proofStats)
      if (certificate) {
        this.result = { status: "contradictory-choice", certificate }
        this.normalRows.clear()
        return
      }
    }
    this.stats.hashProbes++
    const same = this.normalRows.get(key)
    if (same === undefined || this.constraints[same]!.maximum > row.maximum) this.normalRows.set(key, index)
  }

  override _step(): void {
    if (this.constraints.length === 0) {
      this.result = { status: "feasible", values: Array.from(this.point) }
    }
    let batch = 0
    while (!this.result && batch < 4096) {
      if (this.phase === "preprocess") {
        this.preprocessRow()
        batch++
        continue
      }
      if (this.constraintChecks >= this.workCap) {
        this.stopUnknown("work-cap")
        break
      }
      if (this.row === this.constraints.length) {
        this.row = 0
        if (this.phase === "update") {
          this.phase = "verify"
          this.violations = 0
          this.residuals.clear()
        } else {
          this.sweeps++
          if (this.violations === 0) {
            this.result = { status: "feasible", values: Array.from(this.point) }
            break
          }
          if (this.sweeps >= this.sweepCap) {
            this.stopUnknown("sweep-cap")
            break
          }
          this.phase = "update"
        }
      }
      const index = this.row++
      const constraint = this.constraints[index]!
      let residual = -constraint.maximum
      for (const term of constraint.terms) {
        residual += term.coefficient * this.point[term.variable]!
      }
      this.constraintChecks++
      batch++
      if (!Number.isFinite(residual)) {
        this.stopUnknown("numerical")
        break
      }
      if (this.phase === "verify") {
        this.stats.residualChecks++
        if (residual > 1e-10) {
          this.violations++
          if (constraint.family !== undefined) {
            this.residuals.set(constraint.family, Math.max(residual, this.residuals.get(constraint.family) ?? 0))
          }
        }
        continue
      }
      this.stats.rowUpdates++
      const norm = this.norms[index]!
      if (norm === 0) {
        if (residual > 1e-10) this.stopUnknown("constant-constraint")
        continue
      }
      const next = Math.max(0, this.dual[index]! + residual / norm)
      if (!Number.isFinite(next)) {
        this.stopUnknown("numerical")
        break
      }
      const change = next - this.dual[index]!
      this.dual[index] = next
      for (const term of constraint.terms) {
        this.point[term.variable] = this.point[term.variable]! - change * term.coefficient
      }
    }
    this.stats.exactRowChecks = this.proofStats.rowChecks
    this.stats.proofTermReads = this.proofStats.termReads
    this.stats.exactTermComparisons = this.proofStats.termComparisons
    this.stats.proofSortComparisons = this.proofStats.sortComparisons
    this.stats.constraintChecks = this.constraintChecks
    this.stats.sweeps = this.sweeps
    if (this.result) {
      this.solved = true
      this.progress = 1
    }
  }

  getOutput(): HalfspaceProjectionResult {
    if (!this.solved || !this.result) {
      throw new Error("Half-space projection is incomplete")
    }
    return this.result
  }
}
