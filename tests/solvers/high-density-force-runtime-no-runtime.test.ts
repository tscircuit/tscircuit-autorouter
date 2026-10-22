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

test("no-runtime prefixes and empty force samples retain the serial lifecycle", async (): Promise<void> => {
  const baseline = new HighDensityForceImproveSolver(
    createHighDensityForceImproveRuntimeFixture(),
  )
  const solver = new Pipeline9HighDensityForceImproveSolver(
    createHighDensityForceImproveRuntimeFixture(),
  )
  baseline.step()
  await solver.solveAsync(undefined, 1)
  expectHighDensityForceImproveState(solver, baseline)
  baseline.solve()
  await solver.solveAsync()
  expectHighDensityForceImproveState(solver, baseline)
  const emptyParams = createHighDensityForceImproveRuntimeFixture()
  emptyParams.nodeWithPortPoints = []
  const emptyBaseline = new HighDensityForceImproveSolver(structuredClone(emptyParams))
  const emptySolver = new Pipeline9HighDensityForceImproveSolver(
    structuredClone(emptyParams),
  )
  const runtime = new SolverRuntime()
  try {
    await emptySolver.solveAsync(runtime, 0)
    expectHighDensityForceImproveState(emptySolver, emptyBaseline)
    emptyBaseline.solve()
    await emptySolver.solveAsync(runtime)
    expectHighDensityForceImproveState(emptySolver, emptyBaseline)
    expect(emptySolver.iterations).toBe(1)
    expect(emptySolver.activeSampleIndex).toBe(0)
    expect(emptySolver.getOutput()).toStrictEqual(emptyParams.hdRoutes)
  } finally {
    await runtime.dispose()
  }
})
