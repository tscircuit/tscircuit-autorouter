import { expect, test } from "bun:test"
import { classifyIteration } from "../scripts/iteration-timing/iterationTimingReport"
import type { SolverIterationAttribution } from "../scripts/iteration-timing/profileSolverIterations"
import type { IterationWhitelistEntry } from "../scripts/iteration-timing/srj18IterationWhitelist"

test("whitelist matching requires the exact solver, phase, and iteration range", (): void => {
  const attribution: SolverIterationAttribution = {
    solverName: "RouteSolver",
    phase: "step",
    localIteration: 1,
    path: ["Pipeline", "RouteSolver"],
    elapsedMs: 1_200,
  }
  const allowed: IterationWhitelistEntry = {
    solverName: attribution.solverName,
    phase: attribution.phase,
    localIteration: attribution.localIteration,
    reason: "Known first step",
  }
  const cases: {
    attribution: SolverIterationAttribution
    whitelist: IterationWhitelistEntry
    expected: boolean
  }[] = [
    { attribution, whitelist: allowed, expected: true },
    {
      attribution: { ...attribution, solverName: "AnotherRouteSolver" },
      whitelist: allowed,
      expected: false,
    },
    {
      attribution: { ...attribution, phase: "initialization" },
      whitelist: allowed,
      expected: false,
    },
    {
      attribution: { ...attribution, localIteration: 2 },
      whitelist: allowed,
      expected: false,
    },
    {
      attribution: { ...attribution, iterationEnd: 2 },
      whitelist: allowed,
      expected: false,
    },
    {
      attribution: { ...attribution, iterationEnd: 2 },
      whitelist: { ...allowed, iterationEnd: 2 },
      expected: true,
    },
    {
      attribution,
      whitelist: { ...allowed, iterationEnd: 2 },
      expected: false,
    },
    {
      attribution: { ...attribution, iterationEnd: 1 },
      whitelist: allowed,
      expected: true,
    },
    {
      attribution: {
        ...attribution,
        phase: "initialization",
        localIteration: 0,
      },
      whitelist: { ...allowed, phase: "initialization", localIteration: 0 },
      expected: true,
    },
  ]

  for (const entry of cases) {
    const classified = classifyIteration(
      {
        ...entry.attribution,
        rootIteration: 42,
        attributions: [entry.attribution],
      },
      [entry.whitelist],
    )
    expect(classified.whitelisted).toBe(entry.expected)
    expect(classified.unlistedAttributions).toEqual(
      entry.expected ? [] : [entry.attribution],
    )
  }
})
