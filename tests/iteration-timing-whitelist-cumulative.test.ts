import { expect, test } from "bun:test"
import { classifyIteration } from "../scripts/iteration-timing/iterationTimingReport"
import type { SolverIterationAttribution } from "../scripts/iteration-timing/profileSolverIterations"
import type { IterationWhitelistEntry } from "../scripts/iteration-timing/srj18IterationWhitelist"

test("a cumulatively slow step requires all contributors when none exceeds 100ms", (): void => {
  const first: SolverIterationAttribution = {
    solverName: "FirstSolver",
    phase: "step",
    localIteration: 1,
    path: ["Pipeline", "FirstSolver"],
    elapsedMs: 80,
  }
  const second: SolverIterationAttribution = {
    solverName: "SecondSolver",
    phase: "initialization",
    localIteration: 0,
    path: ["Pipeline", "SecondSolver"],
    elapsedMs: 90,
  }
  const iteration = {
    ...second,
    rootIteration: 42,
    elapsedMs: 170,
    attributions: [second, first],
  }
  const whitelist: IterationWhitelistEntry[] = [
    {
      solverName: second.solverName,
      phase: second.phase,
      localIteration: second.localIteration,
      reason: "Known initialization",
    },
  ]

  expect(classifyIteration(iteration, whitelist)).toMatchObject({
    whitelisted: false,
    unlistedAttributions: [first],
  })
  whitelist.push({
    solverName: first.solverName,
    phase: first.phase,
    localIteration: first.localIteration,
    reason: "Known first step",
  })
  expect(classifyIteration(iteration, whitelist)).toMatchObject({
    whitelisted: true,
    unlistedAttributions: [],
  })
  expect(
    classifyIteration({ ...iteration, attributions: [] }, whitelist)
      .whitelisted,
  ).toBeFalse()
})
