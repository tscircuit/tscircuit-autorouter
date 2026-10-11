import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import stableStringify from "fast-json-stable-stringify"
import { summarizeParallelBenchmark } from "./parallelBenchmarkSummary"
import type { BenchmarkHighDensityPolicy, BenchmarkPathingStrategy, ParallelBenchmarkResult, ParallelBenchmarkSummary } from "./parallelBenchmarkTypes"

export type ParallelBenchmarkReportSource = {
  sourcePath: string
  report: {
    metadata: Record<string, unknown>
    results: ParallelBenchmarkResult[]
  }
  installedDependencyHash?: string
  sourceReportHash?: string
}

type MergedSource = {
  sourcePath: string
  sourceReportHash?: string
  installedDependencyHash?: string
  metadata: Record<string, unknown>
  sampleNames: string[]
  resultCount: number
}

export type MergedParallelBenchmarkReport = {
  metadata: Record<string, unknown>
  sources: MergedSource[]
  results: ParallelBenchmarkResult[]
  summary: ParallelBenchmarkSummary
}

type SourceOptions = Record<string, unknown> & {
  repetitions: number
  timeoutMs: number
  effort: number
  workerCount: number
  parallelPathSimplification: boolean
  pathingStrategy: BenchmarkPathingStrategy
  highDensityPolicy: BenchmarkHighDensityPolicy
  targetSpeedup: number
  variants: string[]
  sampleNumbers: number[]
}

const expectedSamples = Array.from({ length: 16 }, (_, index) => `sample${String(index + 1).padStart(3, "0")}`)
const comparisonFields = [
  "revision", "baselineRevision", "dataset", "datasetDependency", "datasetHashes",
  "runtime", "cpuModel", "availableParallelism", "timing", "qualityValidationTimeoutMs",
] as const

const getSourceOptions = (source: ParallelBenchmarkReportSource): SourceOptions => {
  const metadata = source.report.metadata
  const raw = metadata.options
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Missing benchmark options: ${source.sourcePath}`)
  }
  const options = {
    ...raw,
    pathingStrategy: (raw as Record<string, unknown>).pathingStrategy ?? "adaptive-bitset",
    highDensityPolicy: (raw as Record<string, unknown>).highDensityPolicy ?? "ordered",
  } as SourceOptions
  if (options.pathingStrategy !== "indexed" && options.pathingStrategy !== "adaptive-bitset" && options.pathingStrategy !== "cached-cost" && options.pathingStrategy !== "landmark" && options.pathingStrategy !== "negotiated" && options.pathingStrategy !== "goal-balls") {
    throw new Error(`Invalid pathingStrategy: ${source.sourcePath}`)
  }
  if (options.highDensityPolicy !== "ordered" && options.highDensityPolicy !== "first-valid") {
    throw new Error(`Invalid highDensityPolicy: ${source.sourcePath}`)
  }
  for (const key of ["repetitions", "timeoutMs", "effort", "workerCount", "targetSpeedup"] as const) {
    if (typeof options[key] !== "number" || !Number.isFinite(options[key]) || options[key] <= 0) {
      throw new Error(`Invalid ${key}: ${source.sourcePath}`)
    }
  }
  if (!Number.isInteger(options.repetitions) || !Number.isInteger(options.workerCount) || options.workerCount > 4 || typeof options.parallelPathSimplification !== "boolean") {
    throw new Error(`Invalid repetitions, workers, or path flag: ${source.sourcePath}`)
  }
  if (!Array.isArray(options.variants) || options.variants.length !== 2 || !options.variants.includes("baseline") || !options.variants.includes("parallel")) {
    throw new Error(`Source must contain both paired variants: ${source.sourcePath}`)
  }
  if (!Array.isArray(options.sampleNumbers) || options.sampleNumbers.length === 0 || new Set(options.sampleNumbers).size !== options.sampleNumbers.length || options.sampleNumbers.some((sample) => !Number.isInteger(sample) || sample < 1 || sample > 16)) {
    throw new Error(`Invalid source sampleNumbers: ${source.sourcePath}`)
  }
  return options
}

export const mergeParallelBenchmarkReports = (
  sources: ParallelBenchmarkReportSource[],
): MergedParallelBenchmarkReport => {
  if (sources.length === 0) throw new Error("At least one paired report is required")
  const reference = sources[0]!
  const referenceOptions = getSourceOptions(reference)
  const sourcePaths = new Set<string>()
  const resultKeys = new Set<string>()
  const sampleOwners = new Map<string, string>()
  const results: ParallelBenchmarkResult[] = []
  const sourceMetadata: MergedSource[] = []
  const dependencyHashes = sources.map((source) => source.installedDependencyHash ?? source.report.metadata.installedDependencyHash)
  const haveDependencyHashes = dependencyHashes.some((hash) => hash !== undefined)
  if (haveDependencyHashes && (dependencyHashes.some((hash) => typeof hash !== "string" || hash.length === 0) || dependencyHashes.some((hash) => hash !== dependencyHashes[0]))) {
    throw new Error("Incompatible or missing installed dependency hash")
  }
  for (const source of sources) {
    if (sourcePaths.has(source.sourcePath)) throw new Error(`Duplicate source path: ${source.sourcePath}`)
    sourcePaths.add(source.sourcePath)
    const metadata = source.report.metadata
    const options = getSourceOptions(source)
    if (metadata.availableParallelism !== 4) throw new Error(`Four-core affinity budget required: ${source.sourcePath}`)
    if (typeof metadata.runner !== "string" || !metadata.runner.startsWith("blacksmith-4vcpu-ubuntu-2404-arm")) {
      throw new Error(`Expected a four-core ARM Blacksmith runner: ${source.sourcePath}`)
    }
    if (metadata.dataset !== "srj18") throw new Error(`Expected SRJ18 dataset: ${source.sourcePath}`)
    for (const field of comparisonFields) {
      if (metadata[field] === undefined || stableStringify(metadata[field]) !== stableStringify(reference.report.metadata[field])) {
        throw new Error(`Incompatible or missing metadata ${field}: ${source.sourcePath}`)
      }
    }
    if (typeof metadata.revision !== "string" || metadata.revision.length === 0 || typeof metadata.baselineRevision !== "string" || metadata.baselineRevision.length === 0) {
      throw new Error(`Missing source revisions: ${source.sourcePath}`)
    }
    const hashes = metadata.datasetHashes as Record<string, unknown>
    if (!hashes || typeof hashes !== "object" || Object.keys(hashes).length !== 16 || expectedSamples.some((sampleName) => typeof hashes[sampleName] !== "string" || hashes[sampleName] === "")) {
      throw new Error(`All 16 dataset hashes are required: ${source.sourcePath}`)
    }
    const { sampleNumbers: _sourceSamples, outDir: _sourceOutDir, ...settings } = options
    const { sampleNumbers: _referenceSamples, outDir: _referenceOutDir, ...referenceSettings } = referenceOptions
    if (stableStringify({ ...settings, variants: [...options.variants].sort() }) !== stableStringify({ ...referenceSettings, variants: [...referenceOptions.variants].sort() })) {
      throw new Error(`Incompatible benchmark options: ${source.sourcePath}`)
    }
    const declaredSamples = options.sampleNumbers.map((sample) => expectedSamples[sample - 1]!).sort()
    const localKeys = new Set<string>()
    for (const result of source.report.results) {
      if (!declaredSamples.includes(result.sampleName) || !Number.isInteger(result.repeat) || result.repeat < 1 || result.repeat > options.repetitions || (result.variant !== "baseline" && result.variant !== "parallel") || !["solved", "failed", "timeout", "crashed"].includes(result.status)) {
        throw new Error(`Invalid source result: ${source.sourcePath}`)
      }
      const key = `${result.sampleName}:${result.repeat}:${result.variant}`
      if (localKeys.has(key) || resultKeys.has(key)) throw new Error(`Duplicate result ${key}: ${source.sourcePath}`)
      localKeys.add(key)
      resultKeys.add(key)
      results.push(result)
    }
    for (const sampleName of declaredSamples) {
      if (sampleOwners.has(sampleName)) throw new Error(`Sample repetitions must remain on one source runner: ${sampleName}`)
      sampleOwners.set(sampleName, source.sourcePath)
      for (let repeat = 1; repeat <= options.repetitions; repeat += 1) {
        if (!localKeys.has(`${sampleName}:${repeat}:baseline`) || !localKeys.has(`${sampleName}:${repeat}:parallel`)) {
          throw new Error(`Missing paired result ${sampleName}:${repeat}: ${source.sourcePath}`)
        }
      }
    }
    sourceMetadata.push({
      sourcePath: source.sourcePath,
      sourceReportHash: source.sourceReportHash,
      installedDependencyHash: source.installedDependencyHash ?? metadata.installedDependencyHash as string | undefined,
      metadata,
      sampleNames: declaredSamples,
      resultCount: source.report.results.length,
    })
  }
  results.sort((left, right) => left.sampleName.localeCompare(right.sampleName) || left.repeat - right.repeat || left.variant.localeCompare(right.variant))
  const summary = summarizeParallelBenchmark(results, {
    expectedSamples,
    repetitions: referenceOptions.repetitions,
    timeoutMs: referenceOptions.timeoutMs,
    targetSpeedup: referenceOptions.targetSpeedup,
    highDensityPolicy: referenceOptions.highDensityPolicy,
    pathingStrategy: referenceOptions.pathingStrategy,
  })
  return {
    metadata: {
      ...reference.report.metadata,
      options: { ...referenceOptions, sampleNumbers: Array.from({ length: 16 }, (_, index) => index + 1), outDir: "merged" },
      runner: "multiple matched four-core ARM Blacksmith runners",
      sourceRunnerCount: new Set(sources.map((source) => source.report.metadata.runner)).size,
      installedDependencyHash: haveDependencyHashes ? dependencyHashes[0] : undefined,
      installedDependenciesVerified: haveDependencyHashes,
      mergedAt: new Date().toISOString(),
    },
    sources: sourceMetadata,
    results,
    summary,
  }
}

const main = async (): Promise<void> => {
  const sourcePaths: string[] = []
  let outDir = "parallel-benchmark-merged"
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (argument === "--out-dir") {
      const value = args[++index]
      if (!value) throw new Error("--out-dir requires a directory")
      outDir = value
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown argument: ${argument}`)
    } else sourcePaths.push(path.resolve(argument))
  }
  const sources = await Promise.all(sourcePaths.map(async (sourcePath): Promise<ParallelBenchmarkReportSource> => {
    const content = await readFile(sourcePath, "utf8")
    const report = JSON.parse(content) as ParallelBenchmarkReportSource["report"]
    let installedDependencyHash: string | undefined
    try {
      const dependencyContent = await readFile(path.join(path.dirname(sourcePath), "installed-dependencies.json"), "utf8")
      const dependencies = JSON.parse(dependencyContent) as Array<Record<string, unknown>>
      dependencies.sort((left, right) => String(left.directory).localeCompare(String(right.directory)))
      installedDependencyHash = createHash("sha256").update(stableStringify(dependencies)).digest("hex")
    } catch (error: unknown) {
      if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    return {
      sourcePath,
      report,
      installedDependencyHash,
      sourceReportHash: createHash("sha256").update(content).digest("hex"),
    }
  }))
  const merged = mergeParallelBenchmarkReports(sources)
  const summary = merged.summary
  const markdown = [
    "# SRJ18 paired benchmark across matched four-core runners",
    "",
    `Prototype revision: ${merged.metadata.revision}`,
    `Baseline revision: ${merged.metadata.baselineRevision}`,
    `Sources: ${merged.sources.length}; runs: ${merged.results.length}; installed dependencies verified: ${merged.metadata.installedDependenciesVerified}`,
    `Arithmetic mean speedup: ${summary.arithmeticMeanSpeedup.toFixed(3)}×; aggregate: ${summary.aggregateSpeedup.toFixed(3)}×; geometric mean: ${summary.geometricMeanSpeedup.toFixed(3)}×.`,
    `High density policy: ${summary.highDensityPolicy}; pathing strategy: ${summary.pathingStrategy}; geometry required: ${summary.geometryRequired}; connection coverage preserved: ${summary.connectionCoveragePreserved}.`,
    `Full coverage: ${summary.fullCoverage}; all solved: ${summary.allCompleted}; exact geometry: ${summary.exactGeometry}; quality preserved: ${summary.qualityPreserved}; target reached: ${summary.targetReached}.`,
    "",
    "| Sample | Baseline median (s) | Parallel median (s) | Speedup | Solved base/parallel | Geometry | Quality |",
    "| --- | ---: | ---: | ---: | --- | --- | --- |",
    ...summary.perSample.map((sample) => `| ${sample.sampleName} | ${(sample.baselineTimeMs / 1000).toFixed(3)} | ${(sample.parallelTimeMs / 1000).toFixed(3)} | ${sample.speedup.toFixed(3)}× | ${sample.baselineSolved}/${sample.parallelSolved} | ${sample.exactGeometry} | ${sample.qualityPreserved} |`),
    "",
    "| Source report | Runner | Samples | Runs | Dependency hash |",
    "| --- | --- | --- | ---: | --- |",
    ...merged.sources.map((source) => `| ${source.sourcePath.replaceAll("|", "\\|")} | ${String(source.metadata.runner)} | ${source.sampleNames.join(", ")} | ${source.resultCount} | ${source.installedDependencyHash ?? "unavailable"} |`),
  ].join("\n")
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, "report.json"), JSON.stringify(merged, null, 2))
  await writeFile(path.join(outDir, "report.md"), markdown)
  console.log(markdown)
}

if (import.meta.main) await main()
