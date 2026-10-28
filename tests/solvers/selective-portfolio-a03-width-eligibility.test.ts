import { expect, test } from "bun:test"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { selectiveTestNode } from "./selectivePortfolioTestUtils"

class AdmissionAuditPortfolio extends PortfolioSingleIntraNodeSolver {
  readonly admitted: Array<Record<string, any>> = []

  override generateSolver(hyperParameters: Record<string, any>): IntraNodeRouteSolver {
    this.admitted.push(hyperParameters)
    const candidate = new BaseSolver()
    candidate.failed = true
    candidate.error = "Synthetic exhausted candidate for admission-only test"
    return candidate as IntraNodeRouteSolver
  }
}

test("selective racing admits A03 only for its supported width and leaves legacy eligibility intact", (): void => {
  for (const traceWidth of [undefined, 0.05, 0.1, 0.15, 0.2]) {
    const params = { nodeWithPortPoints: selectiveTestNode, traceWidth }
    const selected = new AdmissionAuditPortfolio({ ...params, selectivePortfolio: true })
    selected.solve()
    expect(selected.admitted.some((hp) => hp.HIGH_DENSITY_A03)).toBe(traceWidth === 0.1)
    expect(selected.stats.selectiveA03Eligible).toBe(traceWidth === 0.1)
    for (const portfolioMode of ["legacy", "eager", "lazy"] as const) {
      const deterministic = new AdmissionAuditPortfolio({ ...params, portfolioMode })
      deterministic.initializeSolvers()
      expect(deterministic.admitted.some((hp) => hp.HIGH_DENSITY_A03)).toBe(true)
    }
    if (traceWidth !== 0.1) {
      const direct = new PortfolioSingleIntraNodeSolver({ ...params, selectivePortfolio: true })
      expect(() => direct.generateSolver({ HIGH_DENSITY_A03: true })).toThrow("A03 is ineligible")
    }
  }
})
