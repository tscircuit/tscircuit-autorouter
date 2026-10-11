import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import { loadScenarios } from "../benchmark/scenarios"
import { summarizeParallelBenchmark } from "./parallelBenchmarkSummary"
import type { BenchmarkVariant, ParallelBenchmarkChildMessage, ParallelBenchmarkResult } from "./parallelBenchmarkTypes"

type Options = {
  repetitions: number
  timeoutMs: number
  effort: number
  workerCount: number
  targetSpeedup: number
  variants: BenchmarkVariant[]
  sampleNumbers: number[]
  outDir: string
}

const parseOptions = (): Options => {
  const options: Options = {
    repetitions: 3,
    timeoutMs: 180000,
    effort: 1,
    workerCount: 4,
    targetSpeedup: 2,
    variants: ["baseline", "parallel"],
    sampleNumbers: Array.from({ length: 16 }, (_, index) => index + 1),
    outDir: "parallel-benchmark-results",
  }
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index]
    const value = process.argv[index + 1]
    if (!value) throw new Error(`Missing value for ${key}`)
    if (key === "--variants") {
      const variants = value.split(",")
      if (variants.some((variant) => variant !== "baseline" && variant !== "parallel")) throw new Error("--variants must contain baseline and/or parallel")
      options.variants = [...new Set(variants)] as BenchmarkVariant[]
    } else if (key === "--samples") {
      options.sampleNumbers = [...new Set(value.split(",").map(Number))]
    } else if (key === "--out-dir") {
      options.outDir = value
    } else {
      const numeric = Number(value)
      if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`Invalid ${key}: ${value}`)
      if (key === "--repetitions") options.repetitions = numeric
      else if (key === "--timeout-ms") options.timeoutMs = numeric
      else if (key === "--effort") options.effort = numeric
      else if (key === "--worker-count") options.workerCount = numeric
      else if (key === "--target-speedup") options.targetSpeedup = numeric
      else throw new Error(`Unknown argument ${key}`)
    }
  }
  if (!Number.isInteger(options.repetitions) || !Number.isInteger(options.workerCount) || options.workerCount > 4 || options.sampleNumbers.some((sample) => !Number.isInteger(sample) || sample < 1 || sample > 16)) {
    throw new Error("Repetitions/workers must be integers, workers <= 4, and samples in 1..16")
  }
  return options
}

const runSample = async (
  sampleNumber: number,
  repeat: number,
  variant: BenchmarkVariant,
  options: Options,
): Promise<ParallelBenchmarkResult> => {
  const sampleName = `sample${String(sampleNumber).padStart(3, "0")}`
  const runDir = path.resolve(options.outDir, "runs", `${sampleName}-repeat${repeat}-${variant}`)
  await mkdir(runDir, { recursive: true })
  const scriptPath = path.join(import.meta.dir, "parallelBenchmarkChild.ts")
  console.log(`[start] ${sampleName} repeat=${repeat} ${variant}`)
  return await new Promise<ParallelBenchmarkResult>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, String(sampleNumber), variant, String(repeat), String(options.effort), String(options.workerCount), runDir], { stdio: ["ignore", "pipe", "pipe"] })
    let result: ParallelBenchmarkResult | undefined
    let latestProgress: Extract<ParallelBenchmarkChildMessage, { kind: "progress" }> | undefined
    const progressUpdates: Array<Extract<ParallelBenchmarkChildMessage, { kind: "progress" }>> = []
    let timedOut = false
    let stderr = ""
    const start = performance.now()
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, options.timeoutMs)
    const stdoutLines = createInterface({ input: child.stdout })
    stdoutLines.on("line", (line) => {
      if (!line.startsWith("PARALLEL_BENCHMARK ")) {
        console.log(`[child] ${line}`)
        return
      }
      const message = JSON.parse(line.slice("PARALLEL_BENCHMARK ".length)) as ParallelBenchmarkChildMessage
      if (message.kind === "result") result = message.result
      else {
        latestProgress = message
        progressUpdates.push(message)
        console.log(`[progress] ${sampleName} ${variant} ${(message.elapsedTimeMs / 1000).toFixed(1)}s ${message.phaseName ?? "complete"}`)
      }
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.length > 200000) stderr = stderr.slice(-200000)
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code, signal) => {
      clearTimeout(timer)
      stdoutLines.close()
      const finalResult: ParallelBenchmarkResult = result ?? {
        sampleName,
        repeat,
        variant,
        status: timedOut ? "timeout" : "crashed",
        elapsedTimeMs: performance.now() - start,
        error: timedOut ? `Exceeded ${options.timeoutMs}ms sample timeout` : `Child exited code=${code}, signal=${signal}: ${stderr}`,
        stageTiming: latestProgress?.stageTiming,
        phaseName: latestProgress?.phaseName,
      }
      void Promise.all([
        writeFile(path.join(runDir, "stderr.log"), stderr),
        writeFile(path.join(runDir, "progress.json"), JSON.stringify(progressUpdates, null, 2)),
        writeFile(path.join(runDir, "result.json"), JSON.stringify(finalResult, null, 2)),
      ]).then(() => {
        console.log(`[done] ${sampleName} repeat=${repeat} ${variant} ${finalResult.status} ${(finalResult.elapsedTimeMs / 1000).toFixed(3)}s DRC=${finalResult.quality?.drcErrorCount ?? "n/a"}`)
        resolve(finalResult)
      }, reject)
    })
  })
}

const main = async (): Promise<void> => {
  const options = parseOptions()
  const scenarios = await loadScenarios("srj18", { effort: options.effort })
  const expectedSamples = Array.from({ length: 16 }, (_, index) => `sample${String(index + 1).padStart(3, "0")}`)
  if (scenarios.length !== 16 || scenarios.some(([name], index) => name !== expectedSamples[index])) {
    throw new Error("SRJ18 must contain exactly sample001..sample016")
  }
  const require = createRequire(import.meta.url)
  const datasetRoot = path.dirname(require.resolve("dataset-srj18"))
  const datasetHashes = Object.fromEntries(await Promise.all(expectedSamples.map(async (sampleName) => [sampleName, createHash("sha256").update(new Uint8Array(await readFile(path.join(datasetRoot, "samples", `${sampleName}.json`)))).digest("hex")])))
  const metadata = {
    options,
    dataset: "srj18",
    datasetDependency: JSON.parse(await readFile("package.json", "utf8")).devDependencies["dataset-srj18"],
    datasetHashes,
    revision: process.env.PARALLEL_BENCHMARK_PROTOTYPE_SHA ?? process.env.GITHUB_SHA,
    baselineRevision: process.env.PARALLEL_BENCHMARK_BASELINE_SHA,
    baselineModule: process.env.PARALLEL_BENCHMARK_BASELINE_MODULE,
    runner: process.env.RUNNER_NAME ?? os.hostname(),
    runtime: process.versions,
    cpuModel: os.cpus()[0]?.model,
    availableParallelism: os.availableParallelism(),
    timing: "Construction, solve, owned pool startup and dispose; module import, input clone, output hashing, DRC and lint excluded",
    startedAt: new Date().toISOString(),
  }
  await mkdir(options.outDir, { recursive: true })
  await writeFile(path.join(options.outDir, "metadata.json"), JSON.stringify(metadata, null, 2))
  const results: ParallelBenchmarkResult[] = []
  for (let repeat = 1; repeat <= options.repetitions; repeat += 1) {
    for (const sampleNumber of options.sampleNumbers) {
      const order = (repeat + sampleNumber) % 2 === 0 ? options.variants : [...options.variants].reverse()
      for (const variant of order) {
        results.push(await runSample(sampleNumber, repeat, variant, options))
        const summary = summarizeParallelBenchmark(results, { expectedSamples, repetitions: options.repetitions, timeoutMs: options.timeoutMs, targetSpeedup: options.targetSpeedup })
        await writeFile(path.join(options.outDir, "checkpoint.json"), JSON.stringify({ metadata, results, summary }, null, 2))
      }
    }
  }
  const summary = summarizeParallelBenchmark(results, { expectedSamples, repetitions: options.repetitions, timeoutMs: options.timeoutMs, targetSpeedup: options.targetSpeedup })
  await writeFile(path.join(options.outDir, "report.json"), JSON.stringify({ metadata, results, summary }, null, 2))
  const text = [
    `SRJ18 paired benchmark: ${results.length} runs`,
    `Arithmetic mean speedup: ${summary.arithmeticMeanSpeedup.toFixed(3)}x`,
    `Aggregate speedup: ${summary.aggregateSpeedup.toFixed(3)}x`,
    `Geometric mean speedup: ${summary.geometricMeanSpeedup.toFixed(3)}x`,
    `Full coverage: ${summary.fullCoverage}; all solved: ${summary.allCompleted}; exact geometry: ${summary.exactGeometry}; quality preserved: ${summary.qualityPreserved}`,
    `Target reached: ${summary.targetReached}`,
    "",
    "| Sample | Baseline median (s) | Parallel median (s) | Speedup | Solved base/parallel | Geometry | Quality |",
    "| --- | ---: | ---: | ---: | --- | --- | --- |",
    ...summary.perSample.map((sample) => `| ${sample.sampleName} | ${(sample.baselineTimeMs / 1000).toFixed(3)} | ${(sample.parallelTimeMs / 1000).toFixed(3)} | ${sample.speedup.toFixed(3)}x | ${sample.baselineSolved}/${sample.parallelSolved} | ${sample.exactGeometry} | ${sample.qualityPreserved} |`),
  ].join("\n")
  await writeFile(path.join(options.outDir, "report.md"), text)
  console.log(text)
}

await main()
