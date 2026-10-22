import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import {
  HighDensityForceImproveSolver,
} from "high-density-repair01/lib/HighDensityForceImproveSolver"
import {
  Pipeline9HighDensityForceImproveSolver,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import {
  createHighDensityForceImproveRuntimeFixture,
} from "../fixtures/createHighDensityForceImproveRuntimeFixture"
import {
  expectHighDensityForceImproveState,
} from "../fixtures/expectHighDensityForceImproveState"

test("absolute force prefixes including zero resume identically with sync or async solving", async (): Promise<void> => {
  for (const limit of [0, 1, 2, 3, 4, 5, Infinity]) {
    for (const resumeAsync of [false, true]) {
      const baseline = new HighDensityForceImproveSolver(
        createHighDensityForceImproveRuntimeFixture(),
      )
      const solver = new Pipeline9HighDensityForceImproveSolver(
        createHighDensityForceImproveRuntimeFixture(),
      )
      const runtime = new SolverRuntime()
      try {
        while (
          !baseline.solved &&
          !baseline.failed &&
          baseline.iterations < limit
        )
          baseline.step()
        await solver.solveAsync(runtime, limit)
        expectHighDensityForceImproveState(solver, baseline)
        if (limit === 0) expect(solver.improvedRoutesByIndex.size).toBe(0)
        baseline.solve()
        if (resumeAsync) await solver.solveAsync(runtime)
        else solver.solve()
        expectHighDensityForceImproveState(solver, baseline)
      } finally {
        await runtime.dispose()
      }
    }
  }
})
