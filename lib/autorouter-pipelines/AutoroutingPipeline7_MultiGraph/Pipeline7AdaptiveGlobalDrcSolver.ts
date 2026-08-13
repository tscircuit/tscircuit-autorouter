import { GlobalDrcForceImproveSolver } from "high-density-repair03/lib"

/**
 * Stops DRC repair when a complete solver step stalls or evaluates more
 * candidates than the number of violations it removes. The repair budget
 * therefore follows observed efficiency instead of board size.
 */
export class Pipeline7AdaptiveGlobalDrcSolver extends GlobalDrcForceImproveSolver {
  private previousDrcIssueCount?: number
  private previousCandidateAttempts = 0

  override _step(): void {
    super._step()
    if (this.solved || this.failed) return

    const finalDrcIssueCount = this.stats.finalDrcIssueCount
    const candidateAttempts =
      this.stats.globalDrcForceImproveCandidateAttempts
    if (
      typeof finalDrcIssueCount !== "number" ||
      typeof candidateAttempts !== "number"
    ) {
      return
    }

    const issueCountBeforeStep =
      this.previousDrcIssueCount ?? this.stats.initialDrcIssueCount
    const issuesRepaired = Math.max(
      0,
      (typeof issueCountBeforeStep === "number"
        ? issueCountBeforeStep
        : finalDrcIssueCount) - finalDrcIssueCount,
    )
    const candidateAttemptsThisStep =
      candidateAttempts - this.previousCandidateAttempts
    this.previousDrcIssueCount = finalDrcIssueCount
    this.previousCandidateAttempts = candidateAttempts

    const stalledIterations =
      this.stats.globalDrcForceImproveStalledIterations
    const stopReason =
      typeof stalledIterations === "number" && stalledIterations > 0
        ? "no_improving_candidate"
        : candidateAttemptsThisStep > issuesRepaired
          ? "candidate_work_exceeds_repairs"
          : null
    if (stopReason === null) return

    this.tryFinalAcceptance()
    this.stats = {
      ...this.stats,
      adaptiveDrcStopReason: stopReason,
      adaptiveDrcIssueCountAtStop: finalDrcIssueCount,
      adaptiveDrcCandidateAttemptsAtStop: candidateAttempts,
      adaptiveDrcIssuesRepairedInLastStep: issuesRepaired,
    }
  }
}
