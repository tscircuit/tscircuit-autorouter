import { expect, test } from "bun:test"
import { classifyIteration } from "../scripts/iteration-timing/iterationTimingReport"
import type { SolverIterationAttribution } from "../scripts/iteration-timing/profileSolverIterations"
import type { IterationWhitelistEntry } from "../scripts/iteration-timing/srj18IterationWhitelist"

test("every material deepest contributor needs its own whitelist entry", (): void => {
  const parent: SolverIterationAttribution = {
    solverName: "ParentSolver",
    phase: "step",
    localIteration: 1,
    path: ["Pipeline", "ParentSolver"],
    elapsedMs: 1_200,
  }
  const child: SolverIterationAttribution = {
    solverName: "DeepestSolver",
    phase: "step",
    localIteration: 1,
    path: ["Pipeline", "ParentSolver", "DeepestSolver"],
    elapsedMs: 1_100,
  }
  const bookkeeping: SolverIterationAttribution = {
    solverName: "Pipeline",
    phase: "step",
    localIteration: 42,
    path: ["Pipeline"],
    elapsedMs: 100,
  }
  const iteration = {
    ...parent,
    rootIteration: 42,
    elapsedMs: 2_400,
    attributions: [parent, child, bookkeeping],
  }
  const whitelist: IterationWhitelistEntry[] = [
    {
      solverName: parent.solverName,
      phase: parent.phase,
      localIteration: parent.localIteration,
      reason: "Known parent work",
    },
  ]

  expect(classifyIteration(iteration, whitelist)).toMatchObject({
    whitelisted: false,
    unlistedAttributions: [child],
  })
  whitelist.push({
    solverName: child.solverName,
    phase: child.phase,
    localIteration: child.localIteration,
    reason: "Known deepest child work",
  })
  expect(classifyIteration(iteration, whitelist)).toMatchObject({
    whitelisted: true,
    unlistedAttributions: [],
  })
  expect(classifyIteration(iteration, whitelist.slice(1))).toMatchObject({
    whitelisted: false,
    unlistedAttributions: [parent],
  })
})
