import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { availableParallelism, cpus } from "node:os"
import { isDeepStrictEqual } from "node:util"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib"
import { Pipeline4HighDensityRepairSolver } from "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { SimpleRouteJson } from "../../lib/types"
import type { HighDensityRepairSampleInput, HighDensityRepairSampleResult } from "../../lib/solvers/HighDensityRepairSolver/solveHighDensityRepairSample"
import { readLocalCpuTopology } from "./localHighDensityClusterResources"
import { ParallelRepairWorkerPool } from "./ParallelRepairWorkerPool"
import { loadScenarios, parseDatasetName, type DatasetName } from "./scenarios"

type ComparisonOptions = {
  dataset: DatasetName
  limit: number
  repeats: number
  workerCounts: number[]
  repairOnly: boolean
}

type RepairParams = ConstructorParameters<typeof Pipeline4HighDensityRepairSolver>[0]

type ComparisonRun = {
  dataset: string
  sampleNumber: number
  scenarioName: string
  repeat: number
  workers: number
  totalMs: number
  repairMs: number
  outputHash: string
  repairStats: Record<string, unknown>
  status: "solved" | "failed"
  error: string | null
}

function parseOptions(args: string[]): ComparisonOptions {
  const options: ComparisonOptions = { dataset: "dataset01", limit: 10, repeats: 3, workerCounts: [2, 4, 8], repairOnly: false }
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!value) throw new Error(`Missing value for ${flag}`)
    if (flag === "--dataset") {
      const dataset = parseDatasetName(value)
      if (!dataset) throw new Error(`Unknown dataset ${value}`)
      options.dataset = dataset
    } else if (flag === "--limit" || flag === "--repeats") {
      const count = Number(value)
      if (!Number.isSafeInteger(count) || count < 1) throw new Error(`${flag} must be a positive integer`)
      if (flag === "--limit") options.limit = count
      else options.repeats = count
    } else if (flag === "--repair-only") {
      if (value !== "true" && value !== "false") throw new Error("--repair-only requires true or false")
      options.repairOnly = value === "true"
    } else if (flag === "--worker-counts") {
      const counts = value.split(",").map(Number)
      if (counts.length === 0 || counts.some((count): boolean => !Number.isSafeInteger(count) || count < 1)) {
        throw new Error("--worker-counts must be positive integers")
      }
      options.workerCounts = [...new Set(counts)]
    } else throw new Error(`Unknown argument ${flag}`)
  }
  return options
}

async function runPipeline(
  srj: SimpleRouteJson,
  workers: number,
  pool: ParallelRepairWorkerPool,
): Promise<Omit<ComparisonRun, "dataset" | "sampleNumber" | "scenarioName" | "repeat" | "workers">> {
  const start = performance.now()
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj), {
    cacheProvider: null,
    effort: 1,
    ...(workers > 0 ? {
      parallelRepair: {
        concurrency: workers,
        executor: (input: HighDensityRepairSampleInput): Promise<HighDensityRepairSampleResult> => pool.execute(input),
      },
    } : {}),
  })
  if (workers === 0) pipeline.solve()
  else await pipeline.solveAsync()
  const totalMs = performance.now() - start
  if (!pipeline.solved && !pipeline.failed) throw new Error("Benchmark pipeline did not terminate")
  const status = pipeline.solved ? "solved" : "failed"
  // Output serialization and hashing are excluded from the routing timer.
  const outputHash = status === "solved"
    ? createHash("sha256").update(JSON.stringify(pipeline.getOutputSimpleRouteJson())).digest("hex")
    : ""
  return {
    totalMs,
    repairMs: pipeline.timeSpentOnPhase.highDensityRepairSolver ?? 0,
    outputHash,
    repairStats: pipeline.highDensityRepairSolver?.stats ?? {},
    status,
    error: pipeline.error,
  }
}

async function runRepair(
  params: RepairParams,
  workers: number,
  pool: ParallelRepairWorkerPool,
): Promise<Omit<ComparisonRun, "dataset" | "sampleNumber" | "scenarioName" | "repeat" | "workers">> {
  const start = performance.now()
  const repair = new Pipeline4HighDensityRepairSolver({
    ...params,
    ...(workers > 0 ? {
      parallelRepair: {
        concurrency: workers,
        executor: (input: HighDensityRepairSampleInput): Promise<HighDensityRepairSampleResult> => pool.execute(input),
      },
    } : {}),
  })
  const solveStart = performance.now()
  if (workers === 0) repair.solve()
  else await repair.solveAsync()
  const end = performance.now()
  if (!repair.solved && !repair.failed) throw new Error("Benchmark repair did not terminate")
  return {
    totalMs: end - start,
    repairMs: end - solveStart,
    outputHash: createHash("sha256").update(JSON.stringify(repair.getOutput())).digest("hex"),
    repairStats: repair.stats,
    status: repair.solved ? "solved" : "failed",
    error: repair.error,
  }
}

function median(values: number[]): number {
  if (values.length === 0) throw new Error("Cannot calculate an empty median")
  const sorted = [...values].sort((left, right): number => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const topology = readLocalCpuTopology()
  const effectiveCpus = Math.min(topology.affinityCpuIds.length, topology.quotaCpuCount ?? Infinity, availableParallelism())
  const maxWorkers = Math.max(...options.workerCounts)
  if (effectiveCpus < maxWorkers + 1) {
    throw new Error(`Need ${maxWorkers + 1} effective CPUs (workers plus coordinator), found ${effectiveCpus}`)
  }
  const runtime = { bunVersion: Bun.version, cpuModel: cpus()[0].model, availableParallelism: availableParallelism(), effectiveCpus, ...topology }
  console.log(`CPU resources: ${JSON.stringify(runtime)}`)
  const scenarios = await loadScenarios(options.dataset, { scenarioLimit: options.limit, effort: 1 })
  const startup = performance.now()
  const pool = new ParallelRepairWorkerPool(maxWorkers)
  const results: ComparisonRun[] = []
  const preparationTimes: { sampleNumber: number; elapsedMs: number }[] = []
  const skipped: { sampleNumber: number; scenarioName: string; error: string | null }[] = []
  const save = async (): Promise<void> => {
    await writeFile("parallel-repair-results.json", JSON.stringify({ options, runtime, results, skipped, preparationTimes }, null, 2))
  }
  try {
    const workerMetadata = await pool.ready
    const poolStartupMs = performance.now() - startup
    const expectedAffinity = topology.affinityCpuIds.join(",")
    for (const worker of workerMetadata) {
      const workerCpuIds = worker.affinity.split(",").flatMap((part): number[] => {
        const bounds = part.split("-").map(Number)
        const first = bounds[0]
        const last = bounds[1] ?? first
        return Array.from({ length: last - first + 1 }, (_, index): number => first + index)
      })
      if (worker.availableParallelism < maxWorkers + 1 || workerCpuIds.join(",") !== expectedAffinity) {
        throw new Error("A repair worker lacks the requested CPU capacity or affinity")
      }
    }
    console.log(`Worker startup: ${poolStartupMs.toFixed(1)}ms; affinity: ${JSON.stringify(workerMetadata)}`)
    for (const [scenarioIndex, [scenarioName, srj]] of scenarios.entries()) {
      const sampleNumber = scenarioIndex + 1
      console.log(`Starting ${options.dataset} sample ${sampleNumber}: ${scenarioName}`)
      let repairParams: RepairParams | undefined
      if (options.repairOnly) {
        const start = performance.now()
        const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj), { cacheProvider: null, effort: 1 })
        while (pipeline.getCurrentPhase() !== "highDensityRepairSolver" && !pipeline.solved && !pipeline.failed) pipeline.step()
        preparationTimes.push({ sampleNumber, elapsedMs: performance.now() - start })
        if (pipeline.failed) {
          skipped.push({ sampleNumber, scenarioName, error: pipeline.error })
          console.log(`Skipping sample ${sampleNumber}: upstream routing failed: ${pipeline.error}`)
          await save()
          continue
        }
        if (pipeline.solved) throw new Error("Pipeline finished without reaching node repair")
        const stage = pipeline.pipelineDef.find((step): boolean => step.solverName === "highDensityRepairSolver")
        if (!stage) throw new Error("Pipeline9 repair stage is missing")
        ;[repairParams] = stage.getConstructorParams(pipeline) as [RepairParams]
        console.log(`Prepared repair inputs in ${preparationTimes.at(-1)!.elapsedMs.toFixed(1)}ms`)
      }
      let expected: Awaited<ReturnType<typeof runPipeline>> | undefined
      for (let repeat = 0; repeat < options.repeats; repeat++) {
        // Rotate the comparison order to avoid consistently measuring the baseline first.
        const modes = [0, ...options.workerCounts]
        const offset = (scenarioIndex + repeat) % modes.length
        const order = [...modes.slice(offset), ...modes.slice(0, offset)]
        const runs: ComparisonRun[] = []
        for (const workers of order) {
          const value = repairParams
            ? await runRepair(repairParams, workers, pool)
            : await runPipeline(srj, workers, pool)
          const run = { dataset: options.dataset, sampleNumber, scenarioName, repeat, workers, ...value }
          runs.push(run)
          results.push(run)
          console.log(`sample=${sampleNumber} repeat=${repeat + 1} workers=${workers} status=${run.status} total=${run.totalMs.toFixed(1)}ms repair=${run.repairMs.toFixed(1)}ms`)
          await save()
        }
        const baseline = runs.find((run): boolean => run.workers === 0)!
        if (expected && (baseline.outputHash !== expected.outputHash || baseline.status !== expected.status)) {
          throw new Error(`Sequential output changed across repeats for sample ${sampleNumber}`)
        }
        expected = baseline
        for (const run of runs) {
          if (run.status !== baseline.status || run.error !== baseline.error || run.outputHash !== baseline.outputHash || !isDeepStrictEqual(run.repairStats, baseline.repairStats)) {
            throw new Error(`Determinism mismatch for sample ${sampleNumber}, repeat ${repeat + 1}, ${run.workers} workers`)
          }
        }
        if (baseline.status === "failed") {
          skipped.push({ sampleNumber, scenarioName, error: baseline.error })
          break
        }
      }
    }
    const solved = results.filter((run): boolean => run.status === "solved")
    const samples = [...new Set(solved.map((run): number => run.sampleNumber))]
    if (samples.length === 0) throw new Error("No solved samples to compare")
    const rows = [0, ...options.workerCounts].map((workers) => {
      const runs = solved.filter((run): boolean => run.workers === workers)
      const medians = samples.map((sampleNumber) => {
        const matched = runs.filter((run): boolean => run.sampleNumber === sampleNumber)
        return { totalMs: median(matched.map((run): number => run.totalMs)), repairMs: median(matched.map((run): number => run.repairMs)) }
      })
      return { workers, totalMs: medians.reduce((sum, value): number => sum + value.totalMs, 0), repairMs: medians.reduce((sum, value): number => sum + value.repairMs, 0) }
    })
    const baseline = rows[0]
    const table = [
      options.repairOnly
        ? "| Repair workers | Repair with setup | Repair solve time | Speedup with setup | Repair speedup |"
        : "| Repair workers | Total routing time | Node repair time | Total speedup | Repair speedup |",
      "| --- | ---: | ---: | ---: | ---: |",
      ...rows.map((row): string => `| ${row.workers === 0 ? "Sequential" : row.workers} | ${(row.totalMs / 1000).toFixed(3)}s | ${(row.repairMs / 1000).toFixed(3)}s | ${(baseline.totalMs / row.totalMs).toFixed(2)}x | ${(baseline.repairMs / row.repairMs).toFixed(2)}x |`),
    ].join("\n")
    const report = [
      "## Parallel node repair benchmark", "",
      options.repairOnly ? "Mode: isolated node repair. Upstream routing is prepared once per board; routing the rest of the pipeline is excluded." : "Mode: complete Pipeline9 routing.", "",
      `Dataset: ${options.dataset}. ${samples.length} solved samples; ${skipped.length} failed samples excluded from timing. ${options.repeats} repetitions, rotating run order.`, "",
      `${effectiveCpus} effective CPUs; CPU affinity ${expectedAffinity}; cgroup quota ${topology.quotaCpuCount ?? "unlimited"}. One board at a time; worker threads inherit the runner affinity.`, "",
      `Persistent ${maxWorkers}-worker pool startup: ${poolStartupMs.toFixed(1)}ms, excluded from warm timings. Times sum the per-sample medians. Dispatch and serialization are included. Repair solve time excludes stage construction; the other timing column includes it.`, "",
      table, "",
      options.repairOnly
        ? "Every measured run matched the sequential repair output SHA-256, solve status, and repair statistics. Worker startup must be added when creating a fresh pool for a single board."
        : "Every measured run matched the sequential final SRJ SHA-256, solve status, and repair statistics. Worker startup must be added when creating a fresh pool for a single board.", "",
    ].join("\n")
    await writeFile("parallel-repair-results.json", JSON.stringify({ options, runtime, workerMetadata, poolStartupMs, results, skipped, preparationTimes, summary: rows, deterministic: true }, null, 2))
    await writeFile("parallel-repair-results.md", report)
    console.log(report)
  } finally {
    await pool.close()
  }
}

await main()
