#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { arch, cpus, platform, release, totalmem } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import type { EngineResult, FixedInputEngine } from "./engineWorker"
import { createFreeroutingDsn } from "./freeroutingAdapter"
import { getInstalledDependencyInventory } from "./getInstalledDependencyInventory"
import { loadFixedInput, type FixedInput } from "./loadFixedInput"
import {
  runProcessWithDeadline,
  type ProcessDeadlineResult,
} from "./processDeadline"
import { scoreRouting, type RoutingScore } from "./scoreRouting"

export const FREEROUTING_SHA256 =
  "251101c3eeac22d7e7dfcf6796603279e5d1000283eb82d8f093780f7afc6aa9"

interface ComparisonRun {
  engine: FixedInputEngine
  repetition: number
  order: number
  process: ProcessDeadlineResult
  status: "completed" | "solver_failed" | "failed" | "timed_out"
  engineReportedSolved: boolean | null
  score: RoutingScore | null
  error?: string
  failureStage?: "solver" | "engine" | "worker" | "scoring_or_output"
  artifactDirectory: string
}

interface ComparisonReport {
  schemaVersion: 1
  fixture: FixedInput["manifest"]
  metadata: Record<string, unknown>
  runs: ComparisonRun[]
}

const { values } = parseArgs({
  options: {
    manifest: {
      type: "string",
      default: "tests/fixtures/allwinner-t113/manifest.json",
    },
    output: { type: "string", default: "tmp/allwinner-fixed-input-benchmark" },
    "budget-ms": { type: "string", default: "180000" },
    repetitions: { type: "string", default: "2" },
    java: { type: "string", default: "java" },
    jar: { type: "string" },
  },
  strict: true,
})
const budgetMs = Number(values["budget-ms"])
const repetitions = Number(values.repetitions)
if (
  !Number.isSafeInteger(budgetMs) ||
  budgetMs < 100 ||
  budgetMs > 3600000 ||
  !Number.isSafeInteger(repetitions) ||
  repetitions < 1 ||
  repetitions > 10
) {
  throw new Error(
    "Use an integer budget of 100–3600000 ms and 1–10 repetitions",
  )
}
if (!values.jar)
  throw new Error("--jar must identify the pinned Freerouting 2.4.1 JAR")
if (!values.manifest || !values.output || !values.java)
  throw new Error("Missing manifest, output, or Java path")
const jarPath = resolve(values.jar)
const jarSha256 = createHash("sha256")
  .update(new Uint8Array(await readFile(jarPath)))
  .digest("hex")
if (jarSha256 !== FREEROUTING_SHA256)
  throw new Error("Freerouting JAR SHA256 mismatch")
const input = await loadFixedInput(values.manifest)
// Validate the complete common model before spending either engine's budget.
// The timed Freerouting worker still performs its own DSN conversion.
const expectedDsn = createFreeroutingDsn(input.srj)
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
)
const outputDirectory = resolve(values.output)
await mkdir(dirname(outputDirectory), { recursive: true })
// Refuse stale SES or native outputs from an earlier run.
await mkdir(outputDirectory)
await copyFile(input.inputPath, join(outputDirectory, "fixed-input.srj.json"))
await writeFile(join(outputDirectory, "fixed-input.dsn"), expectedDsn)
await writeFile(
  join(outputDirectory, "manifest.json"),
  JSON.stringify(input.manifest, null, 2),
)
await copyFile(
  join(repositoryRoot, "package.json"),
  join(outputDirectory, "package.json"),
)

const gitVersion = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
})
const gitStatus = spawnSync("git", ["status", "--porcelain"], {
  cwd: repositoryRoot,
  encoding: "utf8",
})
const javaVersion = spawnSync(values.java, ["-version"], { encoding: "utf8" })
for (const command of [gitVersion, gitStatus, javaVersion]) {
  if (command.error) throw command.error
  if (command.status !== 0)
    throw new Error(`Benchmark metadata command failed: ${command.stderr}`)
}
const dependencies = JSON.stringify(
  await getInstalledDependencyInventory(repositoryRoot),
  null,
  2,
)
await writeFile(
  join(outputDirectory, "resolved-dependencies.json"),
  dependencies,
)
const report: ComparisonReport = {
  schemaVersion: 1,
  fixture: input.manifest,
  metadata: {
    startedAt: new Date().toISOString(),
    gitSha: gitVersion.stdout.trim(),
    gitStatus: gitStatus.stdout.trim(),
    bunVersion: Bun.version,
    javaVersion: `${javaVersion.stdout}${javaVersion.stderr}`.trim(),
    jarSha256,
    inputSha256: input.inputSha256,
    dependenciesSha256: createHash("sha256").update(dependencies).digest("hex"),
    dsnSha256: createHash("sha256").update(expectedDsn).digest("hex"),
    platform: platform(),
    arch: arch(),
    release: release(),
    cpuModel: cpus()[0]?.model,
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    runnerName: process.env.RUNNER_NAME ?? null,
    budgetMs,
    repetitions,
    timingBoundary:
      "parent spawn through worker exit; includes runtime startup, input parsing, adaptation, constructors, routing, and output serialization; excludes shared preflight and scoring",
    order:
      "native/freerouting on odd repetitions; freerouting/native on even repetitions; sequential fresh processes",
    nativeOptions: {
      solver: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
      effort: 1,
      cacheProvider: null,
    },
    freeroutingOptions: {
      version: "2.4.1",
      maxPasses: 999999,
      maxThreads: 1,
      optimizer: false,
      fanout: false,
      automaticNeckdown: false,
      copperToEdgeClearanceUm: 150,
    },
    randomness:
      "Engine defaults; no shared seed API is assumed. Repeated outputs are not promised bit-identical.",
    dependencyPolicy:
      "Repository disables lockfile generation; resolved dependency inventory and package specifications are archived. Reinstallation may resolve newer ranged dependencies.",
  },
  runs: [],
}

for (let repetition = 1; repetition <= repetitions; repetition++) {
  const engines: FixedInputEngine[] =
    repetition % 2 === 1 ? ["native", "freerouting"] : ["freerouting", "native"]
  for (const engine of engines) {
    const artifactDirectory = `${repetition}-${engine}`
    const runDirectory = join(outputDirectory, artifactDirectory)
    await mkdir(runDirectory)
    console.log(
      `Starting ${artifactDirectory}: ${budgetMs} ms, input ${input.inputSha256}`,
    )
    const processResult = await runProcessWithDeadline({
      command: [
        process.execPath,
        join(repositoryRoot, "scripts/benchmark/fixed-input/engineWorker.ts"),
        engine,
        input.manifestPath,
        runDirectory,
        values.java,
        jarPath,
      ],
      cwd: repositoryRoot,
      budgetMs,
      logPath: join(runDirectory, "engine.log"),
    })
    const run: ComparisonRun = {
      engine,
      repetition,
      order: report.runs.length + 1,
      process: processResult,
      status: processResult.status === "timed_out" ? "timed_out" : "failed",
      engineReportedSolved: null,
      score: null,
      artifactDirectory,
    }
    if (processResult.status === "exited" && processResult.exitCode === 0) {
      try {
        const result = JSON.parse(
          await readFile(join(runDirectory, "engine-result.json"), "utf8"),
        ) as EngineResult
        if (result.engine !== engine)
          throw new Error("Engine result identity mismatch")
        run.engineReportedSolved = result.engineReportedSolved
        run.status = result.status
        if (result.status === "completed") {
          if (!Array.isArray(result.traces))
            throw new Error("Completed engine did not export traces")
          run.score = scoreRouting(input.srj, result.traces)
        } else {
          run.error = result.error
          run.failureStage =
            result.status === "solver_failed" ? "solver" : "engine"
        }
      } catch (error) {
        run.status = "failed"
        run.failureStage = "scoring_or_output"
        run.error = error instanceof Error ? error.message : String(error)
      }
    } else if (run.status === "failed") {
      run.error = `Worker exit ${processResult.exitCode}, signal ${processResult.signal}; see engine.log`
      run.failureStage = "worker"
    }
    report.runs.push(run)
    await writeFile(
      join(outputDirectory, "comparison.json"),
      JSON.stringify(report, null, 2),
    )
    const rows = report.runs.map(
      (entry) =>
        `| ${entry.order} | ${entry.engine} | ${entry.status} | ${(entry.process.elapsedMs / 1000).toFixed(3)} | ${entry.score ? `${entry.score.connectedConnections}/${entry.score.totalConnections}` : "unavailable"} | ${entry.score?.drcViolationCount ?? "unavailable"} | ${entry.score?.viaCount ?? "unavailable"} | ${entry.score?.traceLengthMm.toFixed(2) ?? "unavailable"} |`,
    )
    await writeFile(
      join(outputDirectory, "comparison.md"),
      [
        `# ${input.manifest.name}`,
        "",
        `Input SHA256: \`${input.inputSha256}\``,
        "",
        `Each engine receives ${budgetMs / 1000} seconds on the same machine. Output is scored only when exported before the deadline. A timeout has no inferred connectivity score.`,
        "",
        "| Order | Engine | Status | Elapsed s | Connected nets | DRC violations | Vias | Length mm |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
        ...rows,
        "",
        "Completed means the engine exported an output; it does not imply that routing is complete or DRC passes. Connectivity and DRC come from the same geometry checker for both engines.",
        "",
        "DRC counts are diagnostic geometry-pair counts and depend on output segmentation. Use connectivity and zero/nonzero DRC to assess success; do not rank engines by raw violation counts.",
        "",
        "This is a signal-only, two-layer, rectangular-obstacle projection of the board. It excludes planes, preloaded fanout, USB coupling/return-path rules, and original mixed trace widths. It is not a manufacturing validation or a replay of the unsaved earlier native phase input.",
        "",
        "See comparison.json for hardware, versions, options, timings, errors, and per-connection findings; each run directory contains raw logs and any exported route.",
        "",
      ].join("\n"),
    )
    console.log(
      `Finished ${artifactDirectory}: ${run.status}, ${(processResult.elapsedMs / 1000).toFixed(3)} s`,
    )
  }
}
// Timeouts and declared solver failures are measured algorithm outcomes.
// Crashes, invalid exports, and scorer errors remain visible as a failed job.
if (report.runs.some((run) => run.status === "failed")) process.exitCode = 1
