import { BaseSolver } from "../../BaseSolver"

export type ContactHalfspace = {
  terms: { variable: number; coefficient: number }[]
  maximum: number
  /** A soft contact has quadratic slack cost; trust and boundary rows are hard. */
  soft: boolean
}

export type ContactHalfspaceResult =
  | {
      status: "projected"
      displacement: Float64Array
      maximumSlack: number
      stationary: boolean
      stopReason: "stationary" | "sweep-cap" | "work-cap"
    }
  | { status: "unknown"; reason: "work-cap" | "hard-residual" }

/**
 * Hildreth dual coordinate minimization for
 *   min .5 ||d||² + .5 penalty ||s||², A d <= b + s, s >= 0.
 * Only contact rows have slack. A checked hard-row witness is required before
 * exporting coordinates. Bounded proposals retain explicit slack and a
 * stationarity flag. Runtime hard rows are boxes, whose exact projection is
 * checked before export. Arbitrary hard rows still require a verified witness;
 * insufficient witness allowance remains unknown, never UNSAT.
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
  private proposalWork = 0
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
    this.proposalWork = 4 * variableCount
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!
      this.proposalWork += 3 + row.terms.length
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
    // Keep this allowance unavailable to dual updates. It pays the coordinate
    // copy, box-bound extraction/projection and every final row check even if
    // the update chunk reaches its work cap halfway through a sweep.
    if (!Number.isSafeInteger(this.proposalWork) || this.work + this.proposalWork > this.workCap) {
      this.result = { status: "unknown", reason: "work-cap" }
      this.solved = true
      return
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

  private finishProjection(stopReason: "stationary" | "sweep-cap" | "work-cap"): void {
    if (!this.reserve(this.proposalWork)) return
    const candidate = this.displacement.slice()
    const lower = new Float64Array(this.variableCount).fill(-Infinity)
    const upper = new Float64Array(this.variableCount).fill(Infinity)
    let boxRows = true
    for (const row of this.rows) {
      if (row.soft || row.terms.length === 0) continue
      if (row.terms.length !== 1) {
        boxRows = false
        break
      }
      const { variable, coefficient } = row.terms[0]!
      if (coefficient > 0) upper[variable] = Math.min(upper[variable]!, row.maximum / coefficient)
      else if (coefficient < 0) lower[variable] = Math.max(lower[variable]!, row.maximum / coefficient)
    }
    let stationary = stopReason === "stationary"
    if (boxRows) for (let variable = 0; variable < candidate.length; variable++) {
      if (lower[variable]! > upper[variable]!) {
        this.result = { status: "unknown", reason: "hard-residual" }
        return
      }
      const projected = Math.max(lower[variable]!, Math.min(upper[variable]!, candidate[variable]!))
      if (projected !== candidate[variable]) stationary = false
      candidate[variable] = projected
    }
    let maximumSlack = 0
    for (let index = 0; index < this.rows.length; index++) {
      const row = this.rows[index]!
      let residual = -row.maximum
      for (const term of row.terms)
        residual += term.coefficient * candidate[term.variable]!
      if (!Number.isFinite(residual)) throw new Error("Nonfinite contact QP witness")
      if (!row.soft && residual > 1e-8) {
        this.result = { status: "unknown", reason: "hard-residual" }
        return
      }
      if (row.soft) maximumSlack = Math.max(maximumSlack, residual)
    }
    this.result = { status: "projected", displacement: candidate, maximumSlack, stationary, stopReason }
  }

  override _step(): void {
    let batch = 0
    while (!this.result && batch < 512) {
      if (this.row === this.rows.length) {
        this.sweeps++
        if (this.maximumChange < 1e-9 || this.rows.length === 0) {
          this.finishProjection("stationary")
          break
        }
        if (this.sweeps >= this.sweepCap) {
          // A bounded QP iterate need not be stationary to be a useful proposal.
          // Export it only after checking every hard row; contact slack remains
          // explicit and the caller still validates actual whole geometry.
          this.finishProjection("sweep-cap")
          break
        }
        this.row = 0
        this.maximumChange = 0
      }
      const index = this.row
      const row = this.rows[index]!
      const updateWork = 1 + row.terms.length * 2
      if (this.work + updateWork + this.proposalWork > this.workCap) {
        this.finishProjection("work-cap")
        break
      }
      if (!this.reserve(updateWork)) throw new Error("Reserved contact QP update exceeded its allowance")
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
