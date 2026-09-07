import { appendFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { AutoroutingPipelineSolver7_MultiGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import {
  classifyIteration,
  writeIterationTimingReport,
} from "../iteration-timing/iterationTimingReport"
import { profileSolverIterations } from "../iteration-timing/profileSolverIterations"
import {
  SRJ18_FASTEST_SAMPLE,
  SRJ18_ITERATION_TARGET_MS,
  SRJ18_ITERATION_THRESHOLD_MS,
  srj18IterationWhitelist,
} from "../iteration-timing/srj18IterationWhitelist"
import { loadScenarios } from "./scenarios"

export const runSrj18IterationTiming = async (
  sampleName = SRJ18_FASTEST_SAMPLE,
): Promise<{ solved: boolean; failed: boolean; totalIterations: number }> => {
  const thresholdMs = Number(
    process.env.SRJ18_ITERATION_THRESHOLD_MS ?? SRJ18_ITERATION_THRESHOLD_MS,
  )
  if (!Number.isFinite(thresholdMs) || thresholdMs < SRJ18_ITERATION_TARGET_MS) {
    throw new Error("SRJ18_ITERATION_THRESHOLD_MS must be at least 100ms")
  }
  const scenarios = await loadScenarios("srj18", { effort: 1 })
  const selected = scenarios.find(([name]) => name === sampleName)
  if (!selected) throw new Error(`Unknown SRJ18 sample: ${sampleName}`)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(selected[1]),
    { effort: 1, cacheProvider: null },
  )
  const profile = profileSolverIterations(solver, {
    thresholdMs: SRJ18_ITERATION_TARGET_MS,
  })
  const report = {
    ...profile,
    sampleName,
    thresholdMs,
    iterations: profile.iterations.map((iteration) =>
      classifyIteration(iteration, srj18IterationWhitelist),
    ),
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    runtime: {
      bun: Bun.version,
      platform: process.platform,
      arch: process.arch,
      commit: process.env.GITHUB_SHA ?? "local",
    },
  }
  writeIterationTimingReport(
    process.env.SRJ18_ITERATION_REPORT_DIR ?? "iteration-timing-results",
    report,
  )
  return report
}

if (import.meta.main) {
  if (process.argv.includes("--discover")) {
    const { discoverFastestSrj18Sample } = await import(
      "../iteration-timing/discoverFastestSrj18Sample"
    )
    const outputDir = process.env.SRJ18_ITERATION_REPORT_DIR ?? "iteration-timing-results"
    await discoverFastestSrj18Sample(outputDir)
    appendFileSync(join(outputDir, "summary.md"), `\n${readFileSync(join(outputDir, "discovery.md"), "utf8")}`)
  } else {
    const sampleIndex = process.argv.indexOf("--sample")
    const result = await runSrj18IterationTiming(
      sampleIndex === -1 ? SRJ18_FASTEST_SAMPLE : process.argv[sampleIndex + 1],
    )
    if (!result.solved || result.failed) process.exitCode = 1
  }
}
