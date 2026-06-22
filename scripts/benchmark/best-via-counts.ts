#!/usr/bin/env bun

import { existsSync } from "node:fs"
import type {
  BenchmarkBestViaCellsReport,
  BenchmarkBestViasReport,
  BestViaCountCell,
  BestViaCountRecord,
  WorkerResult,
} from "./benchmark-types"

export type ParsedBenchmarkReport = {
  version: 1
  datasetName: string
  tests: WorkerResult[]
}

export type BenchmarkReportCollection = {
  version: number
  kind: "benchmark-report-collection"
  reports: ParsedBenchmarkReport[]
}

type WriteBestViasCommand = {
  command: "write-from-report"
  reportPath: string
  outputPath: string
}

type MergeBestViasCommand = {
  command: "merge"
  previousPath: string
  currentPath: string
  outputPath: string
}

type WriteBestViaCellsCommand = {
  command: "write-cells"
  bestViasPath: string
  reportPath: string
  outputPath: string
}

type BestViasCommand =
  | WriteBestViasCommand
  | MergeBestViasCommand
  | WriteBestViaCellsCommand

export type BestViaCountComparison =
  | {
      kind: "missing_via_count"
    }
  | {
      kind: "no_known_best"
      viaCount: number
    }
  | {
      kind: "better_than_best"
      viaCount: number
      deltaViaCount: number
    }
  | {
      kind: "worse_than_best"
      viaCount: number
      deltaViaCount: number
    }
  | {
      kind: "matches_best"
      viaCount: number
    }

const emptyBestViasReport = (): BenchmarkBestViasReport => ({
  version: 1,
  kind: "benchmark-best-vias",
  records: [],
})

const isObjectRecord = (input: unknown): input is Record<string, unknown> =>
  typeof input === "object" && input !== null

const isBestViaCountRecord = (input: unknown): input is BestViaCountRecord => {
  if (!isObjectRecord(input)) {
    return false
  }

  return (
    typeof input.datasetName === "string" &&
    typeof input.solverName === "string" &&
    typeof input.scenarioName === "string" &&
    typeof input.sampleNumber === "number" &&
    typeof input.viaCount === "number" &&
    typeof input.elapsedTimeMs === "number"
  )
}

const isWorkerResult = (input: unknown): input is WorkerResult => {
  if (!isObjectRecord(input)) {
    return false
  }

  return (
    typeof input.solverName === "string" &&
    typeof input.scenarioName === "string" &&
    typeof input.sampleNumber === "number" &&
    typeof input.elapsedTimeMs === "number" &&
    typeof input.didSolve === "boolean" &&
    typeof input.didTimeout === "boolean" &&
    typeof input.relaxedDrcPassed === "boolean"
  )
}

const isBenchmarkBestViasReport = (
  input: unknown,
): input is BenchmarkBestViasReport => {
  if (!isObjectRecord(input)) {
    return false
  }

  return (
    input.version === 1 &&
    input.kind === "benchmark-best-vias" &&
    Array.isArray(input.records) &&
    input.records.every(isBestViaCountRecord)
  )
}

const isParsedBenchmarkReport = (
  input: unknown,
): input is ParsedBenchmarkReport => {
  if (!isObjectRecord(input)) {
    return false
  }

  return (
    input.version === 1 &&
    typeof input.datasetName === "string" &&
    Array.isArray(input.tests) &&
    input.tests.every(isWorkerResult)
  )
}

const isBenchmarkReportCollection = (
  input: unknown,
): input is BenchmarkReportCollection => {
  if (!isObjectRecord(input)) {
    return false
  }

  return (
    input.kind === "benchmark-report-collection" &&
    Array.isArray(input.reports) &&
    input.reports.every(isParsedBenchmarkReport)
  )
}

const hasBetterViaCount = ({
  candidateRecord,
  currentRecord,
}: {
  candidateRecord: BestViaCountRecord
  currentRecord: BestViaCountRecord | undefined
}) => {
  if (!currentRecord) {
    return true
  }

  if (candidateRecord.viaCount !== currentRecord.viaCount) {
    return candidateRecord.viaCount < currentRecord.viaCount
  }

  return candidateRecord.elapsedTimeMs < currentRecord.elapsedTimeMs
}

export const makeBestViaCountsFromResults = ({
  results,
  datasetName,
}: {
  results: WorkerResult[]
  datasetName: string
}): BestViaCountRecord[] => {
  const bestRecordByScenarioName = new Map<string, BestViaCountRecord>()

  for (const result of results) {
    if (
      !result.didSolve ||
      !result.relaxedDrcPassed ||
      typeof result.viaCount !== "number"
    ) {
      continue
    }

    const candidateRecord: BestViaCountRecord = {
      datasetName,
      solverName: result.solverName,
      scenarioName: result.scenarioName,
      sampleNumber: result.sampleNumber,
      viaCount: result.viaCount,
      elapsedTimeMs: result.elapsedTimeMs,
    }
    const currentRecord = bestRecordByScenarioName.get(result.scenarioName)

    if (hasBetterViaCount({ candidateRecord, currentRecord })) {
      bestRecordByScenarioName.set(result.scenarioName, candidateRecord)
    }
  }

  return [...bestRecordByScenarioName.values()].sort(
    (firstRecord, secondRecord) =>
      firstRecord.sampleNumber - secondRecord.sampleNumber,
  )
}

const getBestViaRecordsFromReport = (
  benchmarkReport: ParsedBenchmarkReport,
): BestViaCountRecord[] => {
  return makeBestViaCountsFromResults({
    results: benchmarkReport.tests,
    datasetName: benchmarkReport.datasetName,
  })
}

export const getBestViaRecordsFromBenchmarkOutput = (
  benchmarkOutput: ParsedBenchmarkReport | BenchmarkReportCollection,
): BestViaCountRecord[] => {
  if (isBenchmarkReportCollection(benchmarkOutput)) {
    return benchmarkOutput.reports.flatMap((benchmarkReport) =>
      getBestViaRecordsFromReport(benchmarkReport),
    )
  }

  return getBestViaRecordsFromReport(benchmarkOutput)
}

export const mergeBestViasReports = ({
  previousBestViasReport,
  benchmarkOutput,
}: {
  previousBestViasReport: BenchmarkBestViasReport
  benchmarkOutput: ParsedBenchmarkReport | BenchmarkReportCollection
}): BenchmarkBestViasReport => {
  const bestRecordByCircuitKey = new Map<string, BestViaCountRecord>()
  const recordsToMerge = [
    ...previousBestViasReport.records,
    ...getBestViaRecordsFromBenchmarkOutput(benchmarkOutput),
  ]

  for (const candidateRecord of recordsToMerge) {
    const circuitKey = `${candidateRecord.datasetName}::${candidateRecord.scenarioName}`
    const currentRecord = bestRecordByCircuitKey.get(circuitKey)

    if (hasBetterViaCount({ candidateRecord, currentRecord })) {
      bestRecordByCircuitKey.set(circuitKey, candidateRecord)
    }
  }

  return {
    version: 1,
    kind: "benchmark-best-vias",
    records: [...bestRecordByCircuitKey.values()].sort(
      (firstRecord, secondRecord) => {
        if (firstRecord.datasetName !== secondRecord.datasetName) {
          return firstRecord.datasetName.localeCompare(secondRecord.datasetName)
        }

        return firstRecord.sampleNumber - secondRecord.sampleNumber
      },
    ),
  }
}

export const makeBestViasReportFromBenchmarkOutput = (
  benchmarkOutput: ParsedBenchmarkReport | BenchmarkReportCollection,
): BenchmarkBestViasReport => ({
  version: 1,
  kind: "benchmark-best-vias",
  records: getBestViaRecordsFromBenchmarkOutput(benchmarkOutput),
})

export const buildBestViaCountIndex = ({
  bestViasReport,
  datasetName,
}: {
  bestViasReport: BenchmarkBestViasReport
  datasetName: string
}): Map<string, BestViaCountRecord> => {
  const bestRecordByScenarioName = new Map<string, BestViaCountRecord>()

  for (const candidateRecord of bestViasReport.records) {
    if (candidateRecord.datasetName !== datasetName) {
      continue
    }

    const currentRecord = bestRecordByScenarioName.get(
      candidateRecord.scenarioName,
    )

    if (hasBetterViaCount({ candidateRecord, currentRecord })) {
      bestRecordByScenarioName.set(
        candidateRecord.scenarioName,
        candidateRecord,
      )
    }
  }

  return bestRecordByScenarioName
}

const compareViaCountToBest = ({
  workerResult,
  bestViaCountIndex,
}: {
  workerResult: WorkerResult
  bestViaCountIndex: Map<string, BestViaCountRecord>
}): BestViaCountComparison => {
  if (typeof workerResult.viaCount !== "number") {
    return {
      kind: "missing_via_count",
    }
  }

  const bestRecord = bestViaCountIndex.get(workerResult.scenarioName)
  if (!bestRecord) {
    return {
      kind: "no_known_best",
      viaCount: workerResult.viaCount,
    }
  }

  const deltaViaCount = workerResult.viaCount - bestRecord.viaCount
  if (deltaViaCount < 0) {
    return {
      kind: "better_than_best",
      viaCount: workerResult.viaCount,
      deltaViaCount,
    }
  }

  if (deltaViaCount > 0) {
    return {
      kind: "worse_than_best",
      viaCount: workerResult.viaCount,
      deltaViaCount,
    }
  }

  return {
    kind: "matches_best",
    viaCount: workerResult.viaCount,
  }
}

export const formatBestViaCountCell = ({
  comparison,
}: {
  comparison: BestViaCountComparison
}): string => {
  switch (comparison.kind) {
    case "missing_via_count":
      return ""
    case "no_known_best":
      return String(comparison.viaCount)
    case "better_than_best":
      return `${comparison.viaCount} (${comparison.deltaViaCount}, better)`
    case "worse_than_best":
      return `${comparison.viaCount} (+${comparison.deltaViaCount}, worse)`
    case "matches_best":
      return `${comparison.viaCount} (=best)`
  }
}

const makeBestViaCellsForReport = ({
  benchmarkReport,
  bestViasReport,
}: {
  benchmarkReport: ParsedBenchmarkReport
  bestViasReport: BenchmarkBestViasReport
}): BestViaCountCell[] => {
  const bestViaCountIndex = buildBestViaCountIndex({
    bestViasReport,
    datasetName: benchmarkReport.datasetName,
  })

  return benchmarkReport.tests.map((workerResult) => ({
    datasetName: benchmarkReport.datasetName,
    solverName: workerResult.solverName,
    scenarioName: workerResult.scenarioName,
    label: formatBestViaCountCell({
      comparison: compareViaCountToBest({
        workerResult,
        bestViaCountIndex,
      }),
    }),
  }))
}

export const makeBestViaCellsReport = ({
  benchmarkOutput,
  bestViasReport,
}: {
  benchmarkOutput: ParsedBenchmarkReport | BenchmarkReportCollection
  bestViasReport: BenchmarkBestViasReport
}): BenchmarkBestViaCellsReport => ({
  version: 1,
  kind: "benchmark-best-via-cells",
  cells: isBenchmarkReportCollection(benchmarkOutput)
    ? benchmarkOutput.reports.flatMap((benchmarkReport) =>
        makeBestViaCellsForReport({ benchmarkReport, bestViasReport }),
      )
    : makeBestViaCellsForReport({
        benchmarkReport: benchmarkOutput,
        bestViasReport,
      }),
})

const readJsonFile = async (filePath: string): Promise<unknown> => {
  if (!existsSync(filePath)) {
    return null
  }

  const rawJson = await Bun.file(filePath).text()
  if (!rawJson.trim()) {
    return null
  }

  return JSON.parse(rawJson)
}

const readBestViasReport = async (
  filePath: string,
): Promise<BenchmarkBestViasReport> => {
  const parsedJson = await readJsonFile(filePath)

  if (!isBenchmarkBestViasReport(parsedJson)) {
    return emptyBestViasReport()
  }

  return parsedJson
}

const readBenchmarkOutput = async (
  filePath: string,
): Promise<ParsedBenchmarkReport | BenchmarkReportCollection> => {
  const parsedJson = await readJsonFile(filePath)

  if (
    isParsedBenchmarkReport(parsedJson) ||
    isBenchmarkReportCollection(parsedJson)
  ) {
    return parsedJson
  }

  throw new Error(`Invalid benchmark report: ${filePath}`)
}

const getFlagValue = ({
  args,
  flagName,
}: {
  args: string[]
  flagName: string
}) => {
  const flagIndex = args.indexOf(flagName)
  return flagIndex === -1 ? undefined : args[flagIndex + 1]
}

const parseBestViasCommand = (args: string[]): BestViasCommand => {
  const command = args[0]

  if (command === "write-from-report") {
    const reportPath = getFlagValue({ args, flagName: "--report" })
    const outputPath = getFlagValue({ args, flagName: "--out" })

    if (!reportPath || !outputPath) {
      throw new Error("write-from-report requires --report and --out")
    }

    return {
      command,
      reportPath,
      outputPath,
    }
  }

  if (command === "merge") {
    const previousPath = getFlagValue({ args, flagName: "--previous" })
    const currentPath = getFlagValue({ args, flagName: "--current" })
    const outputPath = getFlagValue({ args, flagName: "--out" })

    if (!previousPath || !currentPath || !outputPath) {
      throw new Error("merge requires --previous, --current, and --out")
    }

    return {
      command,
      previousPath,
      currentPath,
      outputPath,
    }
  }

  if (command === "write-cells") {
    const bestViasPath = getFlagValue({ args, flagName: "--best-vias" })
    const reportPath = getFlagValue({ args, flagName: "--report" })
    const outputPath = getFlagValue({ args, flagName: "--out" })

    if (!bestViasPath || !reportPath || !outputPath) {
      throw new Error("write-cells requires --best-vias, --report, and --out")
    }

    return {
      command,
      bestViasPath,
      reportPath,
      outputPath,
    }
  }

  throw new Error(
    "Usage: bun scripts/benchmark/best-via-counts.ts write-from-report --report benchmark-result.json --out benchmark-best-vias.json",
  )
}

const runBestViasCommand = async (bestViasCommand: BestViasCommand) => {
  if (bestViasCommand.command === "write-from-report") {
    const benchmarkOutput = await readBenchmarkOutput(
      bestViasCommand.reportPath,
    )
    const bestViasReport =
      makeBestViasReportFromBenchmarkOutput(benchmarkOutput)
    await Bun.write(
      bestViasCommand.outputPath,
      JSON.stringify(bestViasReport, null, 2),
    )
    return
  }

  if (bestViasCommand.command === "write-cells") {
    const bestViasReport = await readBestViasReport(
      bestViasCommand.bestViasPath,
    )
    const benchmarkOutput = await readBenchmarkOutput(
      bestViasCommand.reportPath,
    )
    const bestViaCellsReport = makeBestViaCellsReport({
      benchmarkOutput,
      bestViasReport,
    })

    await Bun.write(
      bestViasCommand.outputPath,
      JSON.stringify(bestViaCellsReport, null, 2),
    )
    return
  }

  const previousBestViasReport = await readBestViasReport(
    bestViasCommand.previousPath,
  )
  const benchmarkOutput = await readBenchmarkOutput(bestViasCommand.currentPath)
  const mergedBestViasReport = mergeBestViasReports({
    previousBestViasReport,
    benchmarkOutput,
  })

  await Bun.write(
    bestViasCommand.outputPath,
    JSON.stringify(mergedBestViasReport, null, 2),
  )
}

if (import.meta.main) {
  runBestViasCommand(parseBestViasCommand(Bun.argv.slice(2))).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exit(1)
  })
}
