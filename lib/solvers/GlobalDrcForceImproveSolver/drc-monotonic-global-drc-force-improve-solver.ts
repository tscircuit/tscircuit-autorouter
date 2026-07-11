import {
  GlobalDrcForceImproveSolver,
  type DrcSnapshot,
} from "high-density-repair03/lib"
import { getDrcSnapshot } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"

const DRC_SCORE_TOLERANCE = 1e-12

export class DrcMonotonicGlobalDrcForceImproveSolver extends GlobalDrcForceImproveSolver {
  private inputSnapshot?: DrcSnapshot

  private assertOutputDidNotRegress(): void {
    if (!this.solved || !this.inputSnapshot) return

    const outputSnapshot = getDrcSnapshot(
      this.srj,
      this.outputHdRoutes,
      this.drcEvaluator,
      this.connMap,
    )
    const outputIsWorse =
      outputSnapshot.count > this.inputSnapshot.count ||
      (outputSnapshot.count === this.inputSnapshot.count &&
        outputSnapshot.issueScore >
          this.inputSnapshot.issueScore + DRC_SCORE_TOLERANCE)

    if (outputIsWorse) {
      const error = `Global DRC optimization regressed from ${this.inputSnapshot.count} issue(s), score ${this.inputSnapshot.issueScore}, to ${outputSnapshot.count} issue(s), score ${outputSnapshot.issueScore}`
      this.solved = false
      this.failed = true
      this.error = error
      throw new Error(error)
    }
  }

  override _step(): void {
    if (!this.inputSnapshot) {
      this.inputSnapshot = getDrcSnapshot(
        this.srj,
        this.inputHdRoutes,
        this.drcEvaluator,
        this.connMap,
      )

      if (this.inputSnapshot.count === 0) {
        this.outputHdRoutes = this.inputHdRoutes
        this.stats = {
          initialDrcIssueCount: 0,
          finalDrcIssueCount: 0,
          globalDrcForceImproveMaxIterations: this.MAX_ITERATIONS,
          globalDrcForceImproveSkippedCleanInput: true,
        }
        this.solved = true
        return
      }
    }

    super._step()
    this.assertOutputDidNotRegress()
  }

  override tryFinalAcceptance(): void {
    super.tryFinalAcceptance()
    this.assertOutputDidNotRegress()
  }
}
