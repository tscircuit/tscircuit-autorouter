import { spawn } from "node:child_process"
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { arch, cpus, platform } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadScenarios } from "../benchmark/scenarios"

type TrialIdentity = {
  sampleName: string
  trialNumber: number
  wallTimeMs: number
  logPath: string
  resultPath: string
}

export type Srj18DiscoveryTrial = TrialIdentity &
  (
    | { status: "solved"; elapsedTimeMs: number; iterations: number }
    | { status: "failed"; elapsedTimeMs: number | null; error: string }
    | { status: "timed_out"; timeoutMs: number }
  )

type ChildResult = {
  sampleName: string
  elapsedTimeMs: number
  iterations: number
} & ({ status: "solved" } | { status: "failed"; error: string })

export type Srj18DiscoveryRanking = {
  sampleName: string
  medianTimeMs: number
  elapsedTimesMs: number[]
}

export type Srj18DiscoveryReport = {
  version: 1
  dataset: "srj18"
  pipeline: "AutoroutingPipelineSolver7_MultiGraph"
  effort: 1
  cacheProvider: null
  selectedSample: string | null
  generatedAt: string
  timeoutMs: number
  measurement: string
  selection: string
  runtime: {
    bunVersion: string
    platform: string
    architecture: string
    cpuModel: string
    runnerName: string | null
    commitSha: string | null
  }
  firstPassRankings: Srj18DiscoveryRanking[]
  rankings: Srj18DiscoveryRanking[]
  trials: Srj18DiscoveryTrial[]
}

const childTimeoutMs = 90_000

export function getSrj18DiscoveryRankings(
  trials: Srj18DiscoveryTrial[],
  requiredTrials: number,
): Srj18DiscoveryRanking[] {
  const sampleNames = [...new Set(trials.map((trial) => trial.sampleName))]
  const rankings: Srj18DiscoveryRanking[] = []
  for (const sampleName of sampleNames) {
    const sampleTrials = trials.filter((trial) => trial.sampleName === sampleName)
    if (
      sampleTrials.length !== requiredTrials ||
      sampleTrials.some((trial) => trial.status !== "solved")
    ) {
      continue
    }
    const elapsedTimesMs = sampleTrials.map((trial) => {
      if (trial.status !== "solved") {
        throw new Error(`Cannot rank incomplete trial for ${sampleName}`)
      }
      return trial.elapsedTimeMs
    })
    const sortedTimes = [...elapsedTimesMs].sort((a, b) => a - b)
    const middle = Math.floor(sortedTimes.length / 2)
    const medianTimeMs =
      sortedTimes.length % 2 === 1
        ? sortedTimes[middle]!
        : (sortedTimes[middle - 1]! + sortedTimes[middle]!) / 2
    rankings.push({ sampleName, medianTimeMs, elapsedTimesMs })
  }
  return rankings.sort(
    (a, b) =>
      a.medianTimeMs - b.medianTimeMs || a.sampleName.localeCompare(b.sampleName),
  )
}

async function runChildSample(
  sampleName: string,
  outputPath: string,
): Promise<void> {
  const scenarios = await loadScenarios("srj18", { effort: 1 })
  const scenario = scenarios.find(([name]) => name === sampleName)
  if (!scenario) throw new Error(`Unknown SRJ18 sample: ${sampleName}`)
  const { AutoroutingPipelineSolver7_MultiGraph } = await import(
    "../../lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
  )
  const startedAt = performance.now()
  let result: ChildResult
  try {
    const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario[1], {
      effort: 1,
      cacheProvider: null,
    })
    solver.solve()
    const elapsedTimeMs = performance.now() - startedAt
    result =
      solver.solved && !solver.failed
        ? {
            sampleName,
            status: "solved",
            elapsedTimeMs,
            iterations: solver.iterations,
          }
        : {
            sampleName,
            status: "failed",
            elapsedTimeMs,
            iterations: solver.iterations,
            error: solver.error || "Pipeline finished without a solved result",
          }
  } catch (error) {
    result = {
      sampleName,
      status: "failed",
      elapsedTimeMs: performance.now() - startedAt,
      iterations: 0,
      error: error instanceof Error ? error.stack || error.message : String(error),
    }
  }
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)
}

async function runDiscoveryTrial(
  outputDir: string,
  sampleName: string,
  trialNumber: number,
  timeoutMs: number,
): Promise<Srj18DiscoveryTrial> {
  const logPath = join("trials", `${sampleName}-${trialNumber}.log`)
  const resultPath = join("trials", `${sampleName}-${trialNumber}.json`)
  const logFd = openSync(join(outputDir, logPath), "w")
  const startedAt = performance.now()
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      "--child",
      sampleName,
      join(outputDir, resultPath),
    ],
    { stdio: ["ignore", logFd, logFd] },
  )
  closeSync(logFd)
  let timedOut = false
  const outcome = await new Promise<{
    exitCode: number | null
    signal: string | null
    spawnError: string | null
  }>((resolveOutcome) => {
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)
    child.once("error", (error) => {
      clearTimeout(timer)
      resolveOutcome({ exitCode: null, signal: null, spawnError: error.message })
    })
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer)
      resolveOutcome({ exitCode, signal, spawnError: null })
    })
  })
  const identity: TrialIdentity = {
    sampleName,
    trialNumber,
    wallTimeMs: performance.now() - startedAt,
    logPath,
    resultPath,
  }
  if (timedOut) {
    return { ...identity, status: "timed_out", timeoutMs }
  }
  if (outcome.spawnError || outcome.exitCode !== 0) {
    return {
      ...identity,
      status: "failed",
      elapsedTimeMs: null,
      error:
        outcome.spawnError ||
        `Child exited with code ${outcome.exitCode}, signal ${outcome.signal}; see ${logPath}`,
    }
  }
  let result: ChildResult
  try {
    result = JSON.parse(readFileSync(join(outputDir, resultPath), "utf8"))
  } catch (error) {
    return {
      ...identity,
      status: "failed",
      elapsedTimeMs: null,
      error: `Could not read child result: ${String(error)}; see ${logPath}`,
    }
  }
  if (
    result.sampleName !== sampleName ||
    !Number.isFinite(result.elapsedTimeMs) ||
    result.elapsedTimeMs < 0 ||
    (result.status !== "solved" && result.status !== "failed")
  ) {
    throw new Error(`Invalid discovery child result: ${resultPath}`)
  }
  return { ...identity, ...result }
}

function writeDiscoveryReport(
  outputDir: string,
  report: Srj18DiscoveryReport,
): void {
  writeFileSync(
    join(outputDir, "discovery.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  const lines = [
    "# SRJ18 fastest sample discovery",
    "",
    `Selected sample: **${report.selectedSample || "none"}**.`,
    "",
    report.measurement,
    "",
    report.selection,
    "",
    `Pipeline: \`${report.pipeline}\`; effort: 1; cache provider: null.`,
    `Runtime: Bun ${report.runtime.bunVersion}, ${report.runtime.platform}/${report.runtime.architecture}, ${report.runtime.cpuModel}.`,
    `Runner: ${report.runtime.runnerName || "local"}; commit: ${report.runtime.commitSha || "not provided"}.`,
    "",
    "## Repeated candidate rankings",
    "",
    "| Sample | Median solve time | Trial times |",
    "| --- | ---: | --- |",
    ...report.rankings.map(
      (ranking) =>
        `| ${ranking.sampleName} | ${ranking.medianTimeMs.toFixed(1)} ms | ${ranking.elapsedTimesMs.map((time) => `${time.toFixed(1)} ms`).join(", ")} |`,
    ),
    "",
    "## All trials",
    "",
    "Timeouts include startup/import time and exclude the sample from selection; failed solves are also excluded. Measured solve time excludes imports.",
    "",
    "| Sample | Trial | Status | Construction + solve | Child wall time | Details |",
    "| --- | ---: | --- | ---: | ---: | --- |",
    ...report.trials.map((trial) => {
      const elapsed =
        trial.status !== "timed_out" && trial.elapsedTimeMs !== null
          ? `${trial.elapsedTimeMs.toFixed(1)} ms`
          : "—"
      const details =
        trial.status === "failed"
          ? trial.error.replaceAll("|", "\\|").replaceAll("\n", " ")
          : trial.status === "timed_out"
            ? `Killed at ${trial.timeoutMs / 1000}s wall deadline`
            : `${trial.iterations} pipeline iterations`
      return `| ${trial.sampleName} | ${trial.trialNumber} | ${trial.status} | ${elapsed} | ${trial.wallTimeMs.toFixed(1)} ms | ${details}; [log](${trial.logPath}) |`
    }),
    "",
  ]
  writeFileSync(join(outputDir, "discovery.md"), lines.join("\n"))
}

export async function discoverFastestSrj18Sample(
  outputDir: string,
): Promise<Srj18DiscoveryReport & { selectedSample: string }> {
  const absoluteOutputDir = resolve(outputDir)
  mkdirSync(join(absoluteOutputDir, "trials"), { recursive: true })
  const scenarios = await loadScenarios("srj18", { effort: 1 })
  const sampleNames = scenarios
    .map(([sampleName]) => sampleName)
    .sort(
      (a, b) =>
        Number(b === "sample005") - Number(a === "sample005") ||
        a.localeCompare(b),
    )
  const report: Srj18DiscoveryReport = {
    version: 1,
    dataset: "srj18",
    pipeline: "AutoroutingPipelineSolver7_MultiGraph",
    effort: 1,
    cacheProvider: null,
    selectedSample: null,
    generatedAt: new Date().toISOString(),
    timeoutMs: childTimeoutMs,
    measurement:
      "Every trial uses a fresh Bun child process, run serially. Timing covers pipeline construction and solve(), after module imports and dataset loading, without iteration instrumentation.",
    selection:
      "Run every SRJ18 sample once, starting with sample005 (the fastest sample in main run 34137610765). Repeat the three fastest completed samples twice more, then select the lowest median across three successful trials. Each child has at most a 90-second wall deadline, reduced after a successful solve to twice the fastest measured time plus a 10-second startup margin. Timed-out samples are excluded rather than claimed to have completed.",
    runtime: {
      bunVersion: Bun.version,
      platform: platform(),
      architecture: arch(),
      cpuModel: cpus()[0]?.model || "unknown",
      runnerName: process.env.RUNNER_NAME || null,
      commitSha: process.env.GITHUB_SHA || null,
    },
    firstPassRankings: [],
    rankings: [],
    trials: [],
  }
  let fastestTimeMs = Number.POSITIVE_INFINITY
  for (const [sampleIndex, sampleName] of sampleNames.entries()) {
    const timeoutMs = Math.min(childTimeoutMs, fastestTimeMs * 2 + 10_000)
    console.log(
      `[discovery] ${sampleName}, sample ${sampleIndex + 1}/${sampleNames.length}, trial 1 (deadline ${Math.round(timeoutMs)}ms)`,
    )
    const trial = await runDiscoveryTrial(
      absoluteOutputDir,
      sampleName,
      1,
      timeoutMs,
    )
    report.trials.push(trial)
    if (trial.status === "solved") {
      fastestTimeMs = Math.min(fastestTimeMs, trial.elapsedTimeMs)
    }
    console.log(
      `[discovery] ${sampleName}: ${trial.status}, ${Math.round(trial.wallTimeMs)}ms wall`,
    )
    writeDiscoveryReport(absoluteOutputDir, report)
  }
  report.firstPassRankings = getSrj18DiscoveryRankings(report.trials, 1)
  const candidates = report.firstPassRankings.slice(0, 3)
  for (const trialNumber of [2, 3]) {
    for (const candidate of candidates) {
      console.log(`[discovery] ${candidate.sampleName}, trial ${trialNumber}/3`)
      const trial = await runDiscoveryTrial(
        absoluteOutputDir,
        candidate.sampleName,
        trialNumber,
        Math.min(childTimeoutMs, fastestTimeMs * 2 + 10_000),
      )
      report.trials.push(trial)
      console.log(
        `[discovery] ${candidate.sampleName}: ${trial.status}, ${Math.round(trial.wallTimeMs)}ms wall`,
      )
      writeDiscoveryReport(absoluteOutputDir, report)
    }
  }
  report.rankings = getSrj18DiscoveryRankings(report.trials, 3)
  const selectedSample = report.rankings[0]?.sampleName
  report.selectedSample = selectedSample || null
  writeDiscoveryReport(absoluteOutputDir, report)
  if (!selectedSample) {
    throw new Error("No SRJ18 sample completed all three discovery trials")
  }
  return { ...report, selectedSample }
}

if (import.meta.main) {
  const [mode, sampleName, outputPath] = process.argv.slice(2)
  if (mode !== "--child" || !sampleName || !outputPath) {
    throw new Error(
      "This utility is imported by the iteration timing workflow; child usage: --child sampleName outputPath",
    )
  }
  await runChildSample(sampleName, outputPath)
}
