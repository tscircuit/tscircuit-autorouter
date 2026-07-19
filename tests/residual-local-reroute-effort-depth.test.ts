import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { ResidualLocalRerouteSolver } from "lib/solvers/ResidualLocalRerouteSolver/residual-local-reroute-solver"
import {
  residualLocalRerouteError,
  residualLocalRerouteInputRoute,
} from "./fixtures/residual-local-reroute"

test("higher effort continues count-reducing repairs after score refinements", () => {
  const createEvaluator = (): DrcEvaluator =>
    function evaluateResidualRoutes({ routes }) {
      if (!routes) throw new Error("Expected routes for DRC evaluation")
      const pointCount = routes[0]!.route.length
      const issueCount = pointCount < 10 ? 2 : pointCount < 14 ? 1 : 0
      const gap = Math.min(0.099, pointCount / 1000)
      const errors = Array.from({ length: issueCount }, (_, index) => ({
        ...residualLocalRerouteError,
        pcb_trace_error_id: `residual_${index}`,
        message: `Trace is too close to another trace (gap: ${gap.toFixed(3)}mm)`,
      }))
      return { errors, errorsWithCenters: errors }
    }
  const createEffortSolver = (effort: number): ResidualLocalRerouteSolver =>
    new ResidualLocalRerouteSolver({
      hdRoutes: [residualLocalRerouteInputRoute],
      drcEvaluator: createEvaluator(),
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      layerCount: 2,
      effort,
    })

  const baselineSolver = createEffortSolver(1)
  baselineSolver.solve()
  const highEffortSolver = createEffortSolver(50)
  highEffortSolver.solve()

  expect(baselineSolver.stats.residualLocalRerouteFinalDrcIssueCount).toBe(1)
  expect(baselineSolver.stats.residualLocalRerouteAcceptedMoves).toBe(2)
  expect(highEffortSolver.stats.residualLocalRerouteFinalDrcIssueCount).toBe(0)
  expect(highEffortSolver.stats.residualLocalRerouteAcceptedMoves).toBe(3)
  expect(
    highEffortSolver.stats.residualLocalRerouteAcceptedCountReducingMoves,
  ).toBe(2)
  expect(
    highEffortSolver.stats.residualLocalRerouteAcceptedRefinementMoves,
  ).toBe(1)
  expect(highEffortSolver.iterations).toBeLessThanOrEqual(
    highEffortSolver.MAX_ITERATIONS,
  )
})
