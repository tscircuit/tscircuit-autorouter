import { readFile, writeFile } from "node:fs/promises"
import type { BenchmarkReport } from "./benchmark-types"
import { renderSameMachineBenchmarkResults } from "./same-machine-results"

export const validateFourThreadComparison = (
  base: BenchmarkReport,
  candidate: BenchmarkReport,
): void => {
  const solver = "AutoroutingPipelineSolver9_PreloadedTraceGraph"
  const expectedSamples = new Set(Array.from({ length: 16 }, (_, i) => i + 1))
  for (const [label, report] of [["base", base], ["PR", candidate]] as const) {
    if (
      report.datasetName !== "srj18" ||
      report.scenarioCount !== 16 ||
      report.summary.length !== 1 ||
      report.summary[0]?.solverName !== solver ||
      report.tests.length !== 16 ||
      new Set(report.tests.map((sample) => sample.sampleNumber)).size !== 16 ||
      report.tests.some(
        (sample) =>
          sample.solverName !== solver || !expectedSamples.has(sample.sampleNumber),
      )
    ) {
      throw new Error(`${label} is not a full Pipeline9 dataset18 report`)
    }
    if (
      report.runtime?.threadsPerSample !== 4 ||
      report.runtime.effectiveThreadsPerSample !== 4
    ) {
      throw new Error(`${label} did not use four routing threads`)
    }
  }
  if (
    base.effortLabel !== candidate.effortLabel ||
    base.runtime?.workerCount !== candidate.runtime?.workerCount ||
    base.runtime?.bunVersion !== candidate.runtime?.bunVersion ||
    base.tests.some((sample) => {
      const other = candidate.tests.find(
        (item) => item.sampleNumber === sample.sampleNumber,
      )
      return (
        !other ||
        other.scenarioName !== sample.scenarioName ||
        other.sampleTimeoutMs !== sample.sampleTimeoutMs
      )
    })
  ) {
    throw new Error("Base and PR benchmark configurations do not match")
  }
}

if (import.meta.main) {
  const [basePath, prPath, outputPath] = process.argv.slice(2)
  const { BASE_SHA, PR_SHA, BENCHMARK_REPOSITORY, BENCHMARK_RUNNER_NAME } =
    process.env
  if (
    !basePath || !prPath || !outputPath || !BASE_SHA || !PR_SHA ||
    !BENCHMARK_REPOSITORY || !BENCHMARK_RUNNER_NAME
  ) {
    throw new Error("Missing report paths or benchmark provenance")
  }
  const base = JSON.parse(await readFile(basePath, "utf8")) as BenchmarkReport
  const candidate = JSON.parse(await readFile(prPath, "utf8")) as BenchmarkReport
  validateFourThreadComparison(base, candidate)
  const result = renderSameMachineBenchmarkResults({
    baseReport: base,
    prReport: candidate,
    baseSha: BASE_SHA,
    prSha: PR_SHA,
    repository: BENCHMARK_REPOSITORY,
    runnerName: BENCHMARK_RUNNER_NAME,
  })
  await writeFile(
    outputPath,
    `Both passes requested four routing workers per sample, with ${base.runtime!.workerCount} concurrent samples. Base ran before PR on the same machine.\n\n${result}`,
  )
}
