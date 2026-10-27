import { expect, test } from "bun:test"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { loadA64DdrRegionalMemoryParams } from "../fixtures/loadA64DdrMemoryFixture"

test.failing("A64 grow/shrink routing releases retired portfolios when debug capture is disabled", (): void => {
  const params = loadA64DdrRegionalMemoryParams()
  expect(params.nodeWithPortPoints.portPoints).toHaveLength(18)
  const solver = new HighDensitySolver({
    ...params,
    nodePortPoints: [params.nodeWithPortPoints],
    useGrowShrinkHighDensityIntraNodeSolver: true,
    captureSearchDebug: false,
    growShrinkFallbackToInvalidGeometryOnFailure: false,
  })
  solver.step()
  const growth = solver.activeSubSolver
  expect(growth).toBeInstanceOf(GrowShrinkHighDensityIntraNodeSolver)
  const growShrink = growth as GrowShrinkHighDensityIntraNodeSolver
  while (
    growShrink.growthAttempts === 0 &&
    !solver.solved &&
    !solver.failed &&
    solver.iterations < 100_000
  ) {
    solver.step()
  }
  expect(growShrink.growthAttempts).toBeGreaterThan(0)
  expect(growShrink.failedSolvers).toHaveLength(0)
})
