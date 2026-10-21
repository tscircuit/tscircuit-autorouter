import { readFileSync } from "node:fs"
import type { SolverRunSummary, WorkerResult } from "../benchmark/benchmark-types"

type SampleSummary = Pick<WorkerResult,
  "sampleNumber" | "scenarioName" | "elapsedTimeMs" | "peakRssBytes" |
  "sampleTimeoutMs" | "didSolve" | "didTimeout" | "relaxedDrcPassed" |
  "drcErrorCount" | "viaCount" | "stageTiming" | "routingMetrics"
>
const report = JSON.parse(readFileSync("benchmark-result.json", "utf8")) as {
  summary: SolverRunSummary[]
  tests: WorkerResult[]
}
const samples = report.tests.map((test: WorkerResult): SampleSummary => ({
  sampleNumber: test.sampleNumber,
  scenarioName: test.scenarioName,
  elapsedTimeMs: test.elapsedTimeMs,
  peakRssBytes: test.peakRssBytes,
  sampleTimeoutMs: test.sampleTimeoutMs,
  didSolve: test.didSolve,
  didTimeout: test.didTimeout,
  relaxedDrcPassed: test.relaxedDrcPassed,
  drcErrorCount: test.drcErrorCount,
  viaCount: test.viaCount,
  stageTiming: test.stageTiming,
  routingMetrics: test.routingMetrics,
}))
console.log(`CONCURRENT_RESULT ${JSON.stringify({ label: process.argv[2], summary: report.summary, tests: samples })}`)
