import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  GlobalDrcForceImproveSolver,
  TraceContactRepairSolver,
} from "high-density-repair03/lib"
import { getDrcSnapshot } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import {
  createTraceViaShortInput,
  getTraceViaCopperGap,
} from "../fixtures/repair03TraceViaShort"

test("the installed repair03 preserves repairs without publishing a trace-to-via short", (): void => {
  const input = createTraceViaShortInput()
  const original = structuredClone(input)
  expect(getTraceViaCopperGap(input.hdRoutes)).toBeGreaterThan(0.05)
  expect(getDrcSnapshot(input.srj, input.hdRoutes).count).toBe(5)

  for (const enablePostSolveClearanceRelaxation of [false, true]) {
    for (const Solver of [
      GlobalDrcForceImproveSolver,
      GlobalDrcBranchPortfolioSolver,
    ]) {
      const solver = new Solver({
        ...input,
        maxIterations: 16,
        broadMaxIterations: 16,
        broadPassMultiplier: 1,
        enablePostSolveClearanceRelaxation,
      })
      solver.solve()
      const output = solver.getOutput()
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      expect(getTraceViaCopperGap(output)).toBeGreaterThanOrEqual(-1e-9)
      expect(getDrcSnapshot(input.srj, output).count).toBeLessThanOrEqual(2)
      expect(output).toHaveLength(input.hdRoutes.length)
      for (let index = 0; index < output.length; index++) {
        expect(output[index]!.route[0]).toEqual(input.hdRoutes[index]!.route[0])
        expect(output[index]!.route.at(-1)).toEqual(
          input.hdRoutes[index]!.route.at(-1),
        )
      }
    }
  }

  const intermediate = new GlobalDrcForceImproveSolver({
    ...input,
    maxIterations: 16,
    deferTraceContactGuard: true,
  })
  intermediate.solve()
  expect(getTraceViaCopperGap(intermediate.getOutput())).toBeLessThan(0)
  const owner = new TraceContactRepairSolver({
    ...input,
    hdRoutes: intermediate.getOutput(),
    inputHdRoutes: input.hdRoutes,
    broadMaxIterations: 16,
    broadPassMultiplier: 1,
  })
  owner.solve()
  expect(owner.solved).toBe(true)
  expect(owner.failed).toBe(false)
  expect(getTraceViaCopperGap(owner.getOutput())).toBeGreaterThanOrEqual(-1e-9)
  expect(getDrcSnapshot(input.srj, owner.getOutput()).count).toBeLessThanOrEqual(2)
  expect(input).toEqual(original)
})
