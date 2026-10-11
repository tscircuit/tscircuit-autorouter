/** One scan's numeric bound; this class grants no callback/intrinsic authority. */
export class ClosestSquaredDistanceGroups {
  private enabled = true
  private planarValid = false
  private viaValid = false
  private planarMinimum = Infinity
  private viaMinimum = Infinity
  private viaPenalty = 0

  canSkip(square: number, penalty: number, isVia: boolean): boolean {
    // The caller must separately prove that the current callee is the genuine
    // intrinsic sqrt. This numeric bound alone never authorizes skipping it.
    if (!this.enabled || typeof square !== "number" || square !== square ||
      typeof penalty !== "number" || penalty !== penalty) return false
    if (!isVia) return this.planarValid && square >= this.planarMinimum
    const samePenalty = penalty === this.viaPenalty &&
      (penalty !== 0 || 1 / penalty === 1 / this.viaPenalty)
    return this.viaValid && samePenalty && square >= this.viaMinimum
  }

  recordCompleted(square: number, penalty: number, isVia: boolean, total: number): void {
    if (typeof square !== "number" || square !== square || typeof penalty !== "number" ||
      penalty !== penalty || typeof total !== "number" || total !== total) {
      this.enabled = false
      return
    }
    if (!this.enabled) return
    if (!isVia) {
      if (!this.planarValid || square < this.planarMinimum) this.planarMinimum = square
      this.planarValid = true
      return
    }
    const samePenalty = penalty === this.viaPenalty &&
      (penalty !== 0 || 1 / penalty === 1 / this.viaPenalty)
    if (!this.viaValid || !samePenalty || square < this.viaMinimum) {
      this.viaPenalty = penalty
      this.viaMinimum = square
    }
    this.viaValid = true
  }

  disableAfterNonIntrinsicCall(): void {
    // A custom sqrt or unsupported addition can make minDist a string; a
    // later string-to-string comparison need not preserve numeric ordering.
    // Once that happens, every remaining candidate follows native arithmetic.
    // Retaining old groups would incorrectly assume a monotone numeric min.
    this.enabled = false
  }
}
