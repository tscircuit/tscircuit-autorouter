import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type {
  SolverIterationAttribution,
  SolverIterationTiming,
} from "./profileSolverIterations"
import {
  SRJ18_ITERATION_TARGET_MS,
  type IterationWhitelistEntry,
} from "./srj18IterationWhitelist"

export type ClassifiedIteration = SolverIterationTiming & {
  whitelisted: boolean
  unlistedAttributions: SolverIterationAttribution[]
}

export const classifyIteration = (
  iteration: SolverIterationTiming,
  whitelist: readonly IterationWhitelistEntry[],
): ClassifiedIteration => {
  // Inspect every material contributor, not just the largest one: a known
  // parent must never grant permission to an unknown descendant.
  const material = iteration.attributions.filter(
    (entry) => entry.elapsedMs > SRJ18_ITERATION_TARGET_MS,
  )
  const contributors = material.length > 0 ? material : iteration.attributions
  const unlistedAttributions = contributors.filter(
    (entry) =>
      !whitelist.some(
        (allowed) =>
          allowed.solverName === entry.solverName &&
          allowed.phase === entry.phase &&
          allowed.localIteration === entry.localIteration &&
          (allowed.iterationEnd ?? allowed.localIteration) ===
            (entry.iterationEnd ?? entry.localIteration),
      ),
  )
  return {
    ...iteration,
    whitelisted: contributors.length > 0 && unlistedAttributions.length === 0,
    unlistedAttributions,
  }
}

export const describeAttribution = (
  entry: SolverIterationAttribution,
): string => {
  const iteration = entry.iterationEnd
    ? `${entry.localIteration}–${entry.iterationEnd}`
    : String(entry.localIteration)
  return `${entry.solverName} ${entry.phase} ${iteration} (${entry.elapsedMs.toFixed(1)}ms)`
}

export const writeIterationTimingReport = (
  outputDir: string,
  report: {
    sampleName: string
    thresholdMs: number
    elapsedMs: number
    totalIterations: number
    maxIterationMs: number
    iterations: ClassifiedIteration[]
    solverTimings: unknown[]
    solved: boolean
    failed: boolean
    error: string | null
    runtime: { bun: string; platform: string; arch: string; commit: string }
  },
): void => {
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(
    join(outputDir, "iterations.json"),
    JSON.stringify(report, null, 2),
  )
  const warnings = report.iterations.filter(
    (iteration) => iteration.elapsedMs > report.thresholdMs,
  )
  const summary = [
    "# SRJ18 iteration timing",
    "",
    `Sample: **${report.sampleName}**, Pipeline 7, effort 1, cache disabled.`,
    `Runtime: Bun ${report.runtime.bun}, ${report.runtime.platform}/${report.runtime.arch}, commit ${report.runtime.commit}.`,
    `Solved: ${report.solved}; failed: ${report.failed}${report.error ? `; error: ${report.error}` : ""}.`,
    `Completed ${report.totalIterations.toLocaleString("en-US")} pipeline iterations in ${(report.elapsedMs / 1_000).toFixed(2)}s; maximum iteration ${report.maxIterationMs.toFixed(1)}ms.`,
    `Warning threshold: ${report.thresholdMs}ms. ${warnings.length} slow iterations, ${warnings.filter((entry) => !entry.whitelisted).length} with unlisted contributors.`,
    "",
    "Every pipeline step is timed. The table retains steps over 100ms so the future budget can be reviewed now. Attribution follows nested step calls, including synchronous solve loops and children that finish or are created inside the call. Initialization is numbered 0; step iterations are 1-based per solver instance. A range means several child steps ran synchronously inside one pipeline iteration.",
    "",
    "| Pipeline iteration | Duration (ms) | Deepest solver / local iteration | Status |",
    "| ---: | ---: | --- | --- |",
    ...report.iterations.map((entry) => {
      const status =
        entry.elapsedMs > report.thresholdMs
          ? entry.whitelisted
            ? "Whitelisted slow iteration"
            : "WARNING: unlisted"
          : entry.whitelisted
            ? "Whitelisted >100ms candidate"
            : ">100ms candidate"
      const contributors = entry.attributions
        .filter((part) => part.elapsedMs > SRJ18_ITERATION_TARGET_MS)
        .map(describeAttribution)
      return `| ${entry.rootIteration} | ${entry.elapsedMs.toFixed(1)} | ${contributors.length > 0 ? contributors.join("; ") : `${entry.solverName} ${entry.phase} ${entry.localIteration}`} | ${status} |`
    }),
    "",
    "See iterations.json for full active solver paths, all contributors, and aggregate timings. Known slow iterations remain visible; new slow iterations emit warnings without failing this discovery-stage benchmark. Routing failure still fails the test.",
    "",
  ].join("\n")
  writeFileSync(join(outputDir, "summary.md"), summary)
  for (const iteration of warnings) {
    const status = iteration.whitelisted ? "whitelisted" : "UNLISTED"
    const detail = iteration.attributions
      .filter((entry) => entry.elapsedMs > SRJ18_ITERATION_TARGET_MS)
      .map(describeAttribution)
      .join("; ")
    const message = `${report.sampleName} pipeline iteration ${iteration.rootIteration}: ${iteration.elapsedMs.toFixed(1)}ms > ${report.thresholdMs}ms [${status}]; ${detail || `${iteration.solverName} ${iteration.phase} ${iteration.localIteration}`}`
    console.warn(
      process.env.GITHUB_ACTIONS === "true"
        ? `::warning title=Slow SRJ18 iteration::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`
        : `WARNING: ${message}`,
    )
  }
  console.log(summary)
}
