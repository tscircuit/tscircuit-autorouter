import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { combinePreloadedAndRoutedTraces } from "../../lib/testing/evaluate-relaxed-drc"
import type { GetDrcErrorsResult } from "../../lib/testing/getDrcErrors"
import type { BenchmarkDrcInput, BenchmarkReport, WorkerResult } from "./benchmark-types"

type DrcEvaluator = (input: BenchmarkDrcInput) => GetDrcErrorsResult

const hashRoutedGeometry = (input: BenchmarkDrcInput): string => {
  const traces = combinePreloadedAndRoutedTraces(input.inputSrj.traces ?? [], input.routedTraces)
  const geometry = traces.map((trace) => JSON.stringify({
    connectionName: trace.connection_name,
    route: trace.route.map((point) => {
      if (point.route_type === "wire") {
        const { start_pcb_port_id, end_pcb_port_id, ...copper } = point
        return copper
      }
      if (point.route_type === "through_obstacle") {
        const { circuitJsonMetadata, ...copper } = point
        return copper
      }
      return point
    }),
  })).sort()
  return createHash("sha256").update(JSON.stringify(geometry)).digest("hex")
}

/** Score captured outputs with one evaluator without rerunning either solver. */
export const rescoreBenchmarkReport = (
  report: BenchmarkReport,
  evaluateDrc: DrcEvaluator,
  evaluatorSha: string,
): BenchmarkReport => {
  if (report.drcScoring) throw new Error("Benchmark report was already rescored")
  const tests: WorkerResult[] = report.tests.map((test) => {
    if (!test.didSolve) return test
    const { drcInput, ...nativeResult } = test
    if (!drcInput || typeof test.drcErrorCount !== "number") {
      throw new Error(`Missing captured DRC input for ${test.solverName} ${test.scenarioName}`)
    }
    const started = performance.now()
    const { errors } = evaluateDrc(drcInput)
    const commonDrcEvaluationTimeMs = performance.now() - started
    const drcErrorTypes: Record<string, number> = {}
    const messageCounts = new Map<string, number>()
    for (const error of errors) {
      drcErrorTypes[error.type] = (drcErrorTypes[error.type] ?? 0) + 1
      const message = error.message
      messageCounts.set(message, (messageCounts.get(message) ?? 0) + 1)
    }
    return {
      ...nativeResult,
      relaxedDrcPassed: errors.length === 0,
      drcErrorCount: errors.length,
      drcErrorTypes,
      drcErrorMessages: [...messageCounts].map(([message, count]) => ({ message, count })),
      nativeDrc: {
        passed: test.relaxedDrcPassed,
        errorCount: test.drcErrorCount,
        evaluationTimeMs: test.drcEvaluationTimeMs,
      },
      commonDrcEvaluationTimeMs,
      routedGeometryHash: hashRoutedGeometry(drcInput),
      ...(nativeResult.benchmarkSnapshot ? { benchmarkSnapshot: {
        ...nativeResult.benchmarkSnapshot,
        relaxedDrcPassed: errors.length === 0,
        drcErrorCount: errors.length,
      } } : {}),
    }
  })
  const summary = report.summary.map((row) => {
    const solverTests = tests.filter((test) => test.solverName === row.solverName)
    const passing = solverTests.filter((test) => test.didSolve && test.relaxedDrcPassed).length
    const timeoutCount = solverTests.filter((test) => test.didTimeout).length
    const rate = solverTests.length === 0 ? "n/a" : `${(100 * passing / solverTests.length).toFixed(1)}%`
    const timeoutLabel = timeoutCount === 0 ? "" : ` (🕒${(100 * timeoutCount / solverTests.length).toFixed(1)}%)`
    return { ...row, relaxedDrcRateLabel: `${rate}${timeoutLabel}` }
  })
  const scores = new Map(tests.map((test) => [
    `${test.solverName}::${test.scenarioName}::${test.sampleNumber}`, test,
  ]))
  return {
    ...report,
    summary,
    tests,
    snapshots: report.snapshots.map((snapshot) => {
      const score = scores.get(`${snapshot.solverName}::${snapshot.scenarioName}::${snapshot.sampleNumber}`)
      if (!score) throw new Error(`Missing captured snapshot score for ${snapshot.scenarioName}`)
      return { ...snapshot, relaxedDrcPassed: score.relaxedDrcPassed, drcErrorCount: score.drcErrorCount }
    }),
    drcScoring: { kind: "common-core-rules", evaluatorSha },
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const evaluatorSha = args[0]
  const reportPaths = args.slice(1)
  if (!evaluatorSha || reportPaths.length !== 2) {
    throw new Error("Usage: rescore-benchmark-results.ts <evaluator-sha> <main-report.json> <pr-report.json>")
  }
  // Running this script from the PR checkout pins both scores to its checker,
  // converter, connectivity rules, and installed checks dependency.
  const { evaluateRelaxedDrc } = await import("../../lib/testing/evaluate-relaxed-drc")
  for (const reportPath of reportPaths) {
    const report = JSON.parse(await readFile(reportPath, "utf8")) as BenchmarkReport
    const rescored = rescoreBenchmarkReport(report, evaluateRelaxedDrc, evaluatorSha)
    await writeFile(reportPath.replace(/\.json$/, "-common.json"), JSON.stringify(rescored, null, 2))
  }
}
