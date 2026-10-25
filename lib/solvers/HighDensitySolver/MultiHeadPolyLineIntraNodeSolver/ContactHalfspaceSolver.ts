import { BaseSolver } from "../../BaseSolver"

export type ContactHalfspace = {
  terms: { variable: number; coefficient: number }[]
  maximum: number
  /** A soft contact has quadratic slack cost; trust and boundary rows are hard. */
  soft: boolean
}

export type ContactHalfspaceResult =
  | { status: "projected"; displacement: Float64Array; maximumSlack: number; stationary: boolean }
  | { status: "unknown"; reason: "work-cap" | "hard-residual" }

/**
 * Hildreth dual coordinate minimization for
 *   min .5 ||d||² + .5 penalty ||s||², A d <= b + s, s >= 0.
 * Only contact rows have slack. A checked hard-row witness is required before
 * exporting coordinates. Sweep-capped proposals retain explicit slack and a
 * stationarity flag; exhausted work is unknown, never UNSAT.
 */
export class ContactHalfspaceSolver extends BaseSolver {
  readonly displacement: Float64Array
  readonly dual: Float64Array
  readonly norms: Float64Array
  checks = 0
  work = 0
  sweeps = 0
  private row = 0
  private maximumChange = 0
  private result?: ContactHalfspaceResult

  constructor(
    readonly variableCount: number,
    readonly rows: readonly ContactHalfspace[],
    readonly penalty: number,
    readonly workCap: number,
    readonly sweepCap = 64,
  ) {
    super()
    if (
      !Number.isSafeInteger(variableCount) || variableCount < 1 ||
      !Number.isSafeInteger(workCap) || workCap < 0 ||
      !Number.isSafeInteger(sweepCap) || sweepCap < 1 ||
      !Number.isFinite(penalty) || penalty <= 0
    ) throw new Error("Contact QP requires finite dimensions, penalty and work limits")
    this.displacement = new Float64Array(variableCount)
    this.dual = new Float64Array(rows.length)
    this.norms = new Float64Array(rows.length)
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!
      if (!this.reserve(1 + row.terms.length)) {
        this.solved = true
        return
      }
      if (!Number.isFinite(row.maximum)) throw new Error("Nonfinite contact bound")
      const seen = new Set<number>()
      for (const term of row.terms) {
        if (
          !Number.isSafeInteger(term.variable) || term.variable < 0 ||
          term.variable >= variableCount || !Number.isFinite(term.coefficient) ||
          seen.has(term.variable)
        ) throw new Error("Invalid or repeated contact QP variable")
        seen.add(term.variable)
        this.norms[index] += term.coefficient * term.coefficient
      }
      if (!Number.isFinite(this.norms[index])) throw new Error("Contact normal overflow")
    }
    this.MAX_ITERATIONS = Math.ceil(workCap / 512) + 2
  }

  private reserve(units: number): boolean {
    if (this.work + units > this.workCap) {
      this.result = { status: "unknown", reason: "work-cap" }
      return false
    }
    this.work += units
    return true
  }

  private finishProjection(stationary: boolean): void {
    let maximumSlack = 0
    for (let index = 0; index < this.rows.length; index++) {
      const row = this.rows[index]!
      if (!this.reserve(1 + row.terms.length)) return
      let residual = -row.maximum
      for (const term of row.terms)
        residual += term.coefficient * this.displacement[term.variable]!
      if (!Number.isFinite(residual)) throw new Error("Nonfinite contact QP witness")
      if (!row.soft && residual > 1e-8) {
        this.result = { status: "unknown", reason: "hard-residual" }
        return
      }
      if (row.soft) maximumSlack = Math.max(maximumSlack, residual)
    }
    this.result = { status: "projected", displacement: this.displacement, maximumSlack, stationary }
  }

  override _step(): void {
    let batch = 0
    while (!this.result && batch < 512) {
      if (this.row === this.rows.length) {
        this.sweeps++
        if (this.maximumChange < 1e-9 || this.rows.length === 0) {
          this.finishProjection(true)
          break
        }
        if (this.sweeps >= this.sweepCap) {
          // A bounded QP iterate need not be stationary to be a useful proposal.
          // Export it only after checking every hard row; contact slack remains
          // explicit and the caller still validates actual whole geometry.
          this.finishProjection(false)
          break
        }
        this.row = 0
        this.maximumChange = 0
      }
      const index = this.row
      const row = this.rows[index]!
      if (!this.reserve(1 + row.terms.length * 2)) break
      this.row++
      let residual = -row.maximum
      for (const term of row.terms)
        residual += term.coefficient * this.displacement[term.variable]!
      const compliance = row.soft ? 1 / this.penalty : 0
      const denominator = this.norms[index]! + compliance
      this.checks++
      batch++
      if (!Number.isFinite(residual)) throw new Error("Nonfinite contact QP iterate")
      if (denominator === 0) {
        if (residual > 1e-8) this.result = { status: "unknown", reason: "hard-residual" }
        continue
      }
      const next = Math.max(0, this.dual[index]! +
        (residual - compliance * this.dual[index]!) / denominator)
      const change = next - this.dual[index]!
      if (!Number.isFinite(next)) throw new Error("Nonfinite contact dual iterate")
      this.dual[index] = next
      this.maximumChange = Math.max(this.maximumChange, Math.abs(change))
      for (const term of row.terms)
        this.displacement[term.variable] -= change * term.coefficient
    }
    if (this.result) this.solved = true
  }

  getOutput(): ContactHalfspaceResult {
    if (!this.solved || !this.result) throw new Error("Contact QP is incomplete")
    return this.result
  }
}
