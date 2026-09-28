#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { cpus } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import type { CorpusSample } from "../differential-pair-corpus/types"
import { PAIR_METRIC_CONTRACT } from "./evaluatePairOutput"
import { compareResults } from "./compareResults"
import type { BenchmarkConfig, RunResults, SampleResult } from "./types"

type Manifest = {
  samples: Array<{ sampleId: string; path: string; fingerprint: string }>
}

function summarize(samples: SampleResult[]): Record<string, unknown> {
  const durations = samples
    .map((sample) => sample.durationMs)
    .sort((a, b) => a - b)
  const pairs = samples.flatMap((sample) => sample.metrics?.pairs ?? [])
  return {
    samples: samples.length,
    declaredPairs: samples.reduce(
      (sum, sample) => sum + sample.declaredPairCount,
      0,
    ),
    unmeasurablePairs: pairs.filter(
      (pair) => pair.measurementStatus !== "measured",
    ).length,
    pairsWithoutMetrics: samples
      .filter((sample) => sample.metricsStatus === "unavailable")
      .reduce((sum, sample) => sum + sample.declaredPairCount, 0),
    coupling: {
      coupledMm: pairs
        .flatMap((pair) => pair.coupling ?? [])
        .reduce((sum, member) => sum + member.coupledMm, 0),
      uncoupledMm: pairs
        .flatMap((pair) => pair.coupling ?? [])
        .reduce((sum, member) => sum + member.uncoupledMm, 0),
    },
    measuredPairVias: pairs
      .flatMap((pair) => pair.viaCounts ?? [])
      .reduce((sum, vias) => sum + vias, 0),
    drcErrors: samples.reduce(
      (sum, sample) => sum + (sample.metrics?.drcErrorCount ?? 0),
      0,
    ),
    drcUnknown: samples.filter(
      (sample) => !sample.metrics || sample.metrics.drcStatus === "unknown",
    ).length,
    outputAvailable: samples.filter((sample) => sample.outputAvailable).length,
    solved: samples.filter((sample) => sample.metrics?.solved).length,
    timeouts: samples.filter((sample) => sample.timedOut).length,
    metricsUnavailable: samples.filter(
      (sample) => sample.metricsStatus === "unavailable",
    ).length,
    measuredPairs: pairs.filter((pair) => pair.measurementStatus === "measured")
      .length,
    compliantPairs: pairs.filter((pair) => pair.fullCompliance === "pass")
      .length,
    failedPairs: pairs.filter((pair) => pair.fullCompliance === "fail").length,
    unknownPairs: pairs.filter((pair) => pair.fullCompliance === "unknown")
      .length,
    durationP50Ms: durations[Math.ceil(durations.length * 0.5) - 1] ?? null,
    durationP95Ms: durations[Math.ceil(durations.length * 0.95) - 1] ?? null,
    durationAvgMs: durations.length
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : null,
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dataset: { type: "string" },
      "out-dir": { type: "string" },
      limit: { type: "string" },
      sample: { type: "string" },
      solver: {
        type: "string",
        default: "AutoroutingPipelineSolver7_MultiGraph",
      },
      effort: { type: "string", default: "1" },
      "timeout-ms": { type: "string", default: "60000" },
      baseline: { type: "string" },
      "allow-dependency-change": { type: "boolean" },
      help: { type: "boolean" },
    },
  })
  if (values.help) {
    console.log(
      "Usage: ./benchmark.sh --differential-pairs --dataset <corpus-directory> [--out-dir results/runNNN] [--limit N] [--sample ID] [--solver EXPORT] [--effort 1] [--timeout-ms 60000] [--baseline results.json] [--allow-dependency-change]\nRuns the whole corpus by default, sequentially, with a fresh bounded child per sample. Run benchmarks on Blacksmith. Saves input/output/result and logs for every sample. Baseline requires identical selected corpus, config, dependency lock, Bun, and metric versions. Solver source revisions may differ. --allow-dependency-change explicitly permits comparing a dependency fix and records both lock hashes. Partial output survives timeout; metrics may remain unavailable.",
    )
    return
  }
  if (!values.dataset) throw new Error("--dataset is required")
  const config: BenchmarkConfig = {
    solver: values.solver!,
    effort: Number(values.effort),
    timeoutMs: Number(values["timeout-ms"]),
  }
  if (
    !Number.isFinite(config.effort) ||
    config.effort < 1 ||
    !Number.isSafeInteger(config.timeoutMs) ||
    config.timeoutMs < 1
  )
    throw new Error(
      "effort must be >= 1; timeout-ms must be a positive integer",
    )
  const limit = values.limit === undefined ? Infinity : Number(values.limit)
  if (values.limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
    throw new Error("limit must be a positive integer")
  const datasetDirectory = resolve(values.dataset)
  const manifest: Manifest = await Bun.file(
    join(datasetDirectory, "manifest.json"),
  ).json()
  const selected = manifest.samples
    .filter((sample) => !values.sample || sample.sampleId === values.sample)
    .slice(0, limit)
  if (!selected.length) throw new Error("No samples selected")
  let runNumber = 1
  while (existsSync(`results/run${String(runNumber).padStart(3, "0")}`))
    runNumber++
  const outputDirectory = resolve(
    values["out-dir"] ?? `results/run${String(runNumber).padStart(3, "0")}`,
  )
  if (existsSync(outputDirectory))
    throw new Error(`Output directory already exists: ${outputDirectory}`)
  const datasetHash = createHash("sha256")
  for (const entry of selected)
    datasetHash.update(readFileSync(join(datasetDirectory, entry.path), "utf8"))
  const sourceHash = createHash("sha256")
  const files = execFileSync(
    "git",
    ["ls-files", "-c", "-o", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((file) => /^(lib\/|scripts\/|package\.json$|bun\.lock)/.test(file))
    .sort()
  for (const file of new Set(files))
    if (existsSync(file))
      sourceHash.update(file).update(readFileSync(file, "utf8"))
  const metricHash = createHash("sha256")
  for (const file of [
    "evaluatePairOutput.ts",
    "worker.ts",
    "index.ts",
    "compareResults.ts",
    "types.ts",
  ])
    metricHash
      .update(file)
      .update(readFileSync(join(import.meta.dir, file), "utf8"))
  const results: RunResults = {
    schemaVersion: 1,
    metricVersion: PAIR_METRIC_CONTRACT.version,
    metricImplementationSha256: metricHash.digest("hex"),
    createdAt: new Date().toISOString(),
    gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    workingTreeSha256: sourceHash.digest("hex"),
    datasetSha256: datasetHash.digest("hex"),
    dependencyLockSha256: existsSync("bun.lock")
      ? createHash("sha256")
          .update(readFileSync("bun.lock", "utf8"))
          .digest("hex")
      : null,
    bunVersion: Bun.version,
    host: {
      platform: process.platform,
      architecture: process.arch,
      cpu: cpus()[0]?.model ?? "unknown",
    },
    config,
    samples: [],
  }
  const baseline: RunResults | null = values.baseline
    ? await Bun.file(resolve(values.baseline)).json()
    : null
  if (baseline) {
    // Validate configuration and corpus before spending any routing compute.
    compareResults({
      current: { ...results, samples: baseline.samples },
      baseline,
      allowDependencyChange: values["allow-dependency-change"],
    })
  }
  mkdirSync(outputDirectory, { recursive: true })
  for (const entry of selected) {
    if (
      !/^[a-zA-Z0-9_.-]+$/.test(entry.sampleId) ||
      entry.sampleId === "." ||
      entry.sampleId === ".."
    )
      throw new Error(`Unsafe sample id: ${entry.sampleId}`)
    const sample: CorpusSample = await Bun.file(
      join(datasetDirectory, entry.path),
    ).json()
    if (
      sample.sampleId !== entry.sampleId ||
      sample.fingerprint !== entry.fingerprint
    )
      throw new Error(`Manifest mismatch: ${entry.sampleId}`)
    const directory = join(outputDirectory, sample.sampleId)
    mkdirSync(directory)
    writeFileSync(
      join(directory, "input.json"),
      JSON.stringify(sample, null, 2),
    )
    const started = performance.now()
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "worker.ts"),
        join(directory, "input.json"),
        directory,
        JSON.stringify(config),
      ],
      {
        stdout: Bun.file(join(directory, "stdout.txt")),
        stderr: Bun.file(join(directory, "stderr.txt")),
      },
    )
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, config.timeoutMs)
    const exitCode = await child.exited
    clearTimeout(timer)
    const resultPath = join(directory, "result.json")
    const result: SampleResult = existsSync(resultPath)
      ? await Bun.file(resultPath).json()
      : {
          sampleId: sample.sampleId,
          fingerprint: sample.fingerprint,
          kind: sample.kind,
          split: sample.provenance.split,
          familyId: sample.provenance.familyId,
          declaredPairCount: sample.srj.differentialPairs?.length ?? 0,
          durationMs: 0,
          timedOut,
          exitCode,
          outputAvailable: false,
          outputSource: "none",
          metricsStatus: "unavailable",
          metrics: null,
          logicalPaths: [],
          error: "Child ended before recording a result",
        }
    result.durationMs = performance.now() - started
    result.timedOut = timedOut
    result.exitCode = exitCode
    if (result.metrics) result.metrics.timedOut = timedOut
    result.outputAvailable = existsSync(join(directory, "output.json"))
    if (timedOut)
      result.error =
        "Child exceeded wall-clock budget (routing, checkpointing and evaluation combined)"
    writeFileSync(resultPath, JSON.stringify(result, null, 2))
    results.samples.push(result)
    writeFileSync(
      join(outputDirectory, "results.json"),
      JSON.stringify(results, null, 2),
    )
    const line = `${sample.sampleId.padEnd(40)} output=${Number(result.outputAvailable)} metrics=${result.metricsStatus.padEnd(11)} timeout=${Number(timedOut)} duration=${(result.durationMs / 1000).toFixed(3)}s\n`
    process.stdout.write(line)
    appendFileSync(join(outputDirectory, "logs.txt"), line)
  }
  const summary = {
    all: summarize(results.samples),
    byKind: Object.fromEntries(
      ["control", "stress", "infeasible"].map((kind) => [
        kind,
        summarize(results.samples.filter((sample) => sample.kind === kind)),
      ]),
    ),
    byFamily: Object.fromEntries(
      [...new Set(results.samples.map((sample) => sample.familyId))].map(
        (family) => [
          family,
          summarize(
            results.samples.filter((sample) => sample.familyId === family),
          ),
        ],
      ),
    ),
    metricContract: PAIR_METRIC_CONTRACT,
  }
  writeFileSync(
    join(outputDirectory, "summary.json"),
    JSON.stringify(summary, null, 2),
  )
  if (baseline)
    writeFileSync(
      join(outputDirectory, "comparison.json"),
      JSON.stringify(
        compareResults({
          current: results,
          baseline,
          allowDependencyChange: values["allow-dependency-change"],
        }),
        null,
        2,
      ),
    )
  const summaryLine = `duration=summary ${JSON.stringify(summary)}\n`
  process.stdout.write(summaryLine)
  appendFileSync(join(outputDirectory, "logs.txt"), summaryLine)
}

if (import.meta.main) await main()
