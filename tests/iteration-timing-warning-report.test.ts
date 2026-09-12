import { expect, spyOn, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  classifyIteration,
  type ClassifiedIteration,
  writeIterationTimingReport,
} from "../scripts/iteration-timing/iterationTimingReport"
import type { SolverIterationAttribution } from "../scripts/iteration-timing/profileSolverIterations"
import type { IterationWhitelistEntry } from "../scripts/iteration-timing/srj18IterationWhitelist"

test("reports warn for known and unlisted steps strictly over 1s and retain 100ms candidates", (): void => {
  const outputDir = mkdtempSync(join(tmpdir(), "srj18-iteration-report-"))
  const warn = spyOn(console, "warn").mockImplementation((): void => {})
  const log = spyOn(console, "log").mockImplementation((): void => {})
  const previousGitHubActions = process.env.GITHUB_ACTIONS
  process.env.GITHUB_ACTIONS = "true"

  try {
    const whitelist: IterationWhitelistEntry[] = [
      {
        solverName: "KnownSolver",
        phase: "step",
        localIteration: 1,
        reason: "Known first step",
      },
    ]
    const examples = [
      { solverName: "KnownSolver", elapsedMs: 1_200 },
      { solverName: "UnknownSolver", elapsedMs: 1_100 },
      { solverName: "KnownSolver", elapsedMs: 300 },
      { solverName: "UnknownSolver", elapsedMs: 400 },
      { solverName: "BoundarySolver", elapsedMs: 1_000 },
    ]
    const iterations = examples.map((example, index): ClassifiedIteration => {
      const attribution: SolverIterationAttribution = {
        ...example,
        phase: "step",
        localIteration: 1,
        path: ["Pipeline", example.solverName],
      }
      return classifyIteration(
        {
          ...attribution,
          rootIteration: index + 1,
          attributions: [attribution],
        },
        whitelist,
      )
    })
    writeIterationTimingReport(outputDir, {
      sampleName: "fixture-sample",
      thresholdMs: 1_000,
      elapsedMs: 4_000,
      totalIterations: 5,
      maxIterationMs: 1_200,
      iterations,
      solverTimings: [],
      solved: true,
      failed: false,
      error: null,
      runtime: { bun: "test", platform: "test", arch: "test", commit: "test" },
    })

    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0]?.[0]).toBe(
      "::warning title=Slow SRJ18 iteration::fixture-sample pipeline iteration 1: 1200.0ms > 1000ms [whitelisted]; KnownSolver step 1 (1200.0ms)",
    )
    expect(warn.mock.calls[1]?.[0]).toBe(
      "::warning title=Slow SRJ18 iteration::fixture-sample pipeline iteration 2: 1100.0ms > 1000ms [UNLISTED]; UnknownSolver step 1 (1100.0ms)",
    )
    const summary = readFileSync(join(outputDir, "summary.md"), "utf8")
    expect(summary).toContain("2 slow iterations, 1 with unlisted contributors")
    expect(summary).toContain(
      "| 1 | 1200.0 | KnownSolver step 1 (1200.0ms) | Whitelisted slow iteration |",
    )
    expect(summary).toContain(
      "| 2 | 1100.0 | UnknownSolver step 1 (1100.0ms) | WARNING: unlisted |",
    )
    expect(summary).toContain(
      "| 3 | 300.0 | KnownSolver step 1 (300.0ms) | Whitelisted >100ms candidate |",
    )
    expect(summary).toContain(
      "| 4 | 400.0 | UnknownSolver step 1 (400.0ms) | >100ms candidate |",
    )
    expect(summary).toContain(
      "| 5 | 1000.0 | BoundarySolver step 1 (1000.0ms) | >100ms candidate |",
    )
    const saved = JSON.parse(
      readFileSync(join(outputDir, "iterations.json"), "utf8"),
    )
    expect(saved.iterations).toEqual(iterations)
    expect(saved.thresholdMs).toBe(1_000)
  } finally {
    warn.mockRestore()
    log.mockRestore()
    if (previousGitHubActions === undefined) {
      delete process.env.GITHUB_ACTIONS
    } else {
      process.env.GITHUB_ACTIONS = previousGitHubActions
    }
    rmSync(outputDir, { recursive: true, force: true })
  }
})
