import type {
  HybridBenchmarkRun,
  HybridBenchmarkRunStatus,
} from "./types"

export type HybridBenchmarkGate = {
  readonly gate: string
  readonly passed: boolean
  readonly evidence: string
}

export type HybridBenchmarkSummary = {
  readonly engine: HybridBenchmarkRun["engine"]
  readonly sampleCount: number
  readonly solvedCount: number
  readonly zeroDrcCount: number
  readonly inputFailureCount: number
  readonly algorithmicFailureCount: number
  readonly validationFailureCount: number
  readonly timeoutCount: number
  readonly solveRate: number
  readonly zeroDrcRate: number
  readonly averageElapsedMs: number
  readonly p50ElapsedMs: number
  readonly p95ElapsedMs: number
  readonly averageDetailedRoutingMs: number
  readonly averageFinalizationMs: number
  readonly averagePeakHeapBytes: number
  readonly averagePeakRssBytes: number
  readonly averageWorkerUtilization: number | null
}

export type HybridBenchmarkReport = {
  readonly generatedAt: string
  readonly machine: Readonly<Record<string, string | number>>
  readonly configuration: Readonly<Record<string, string | number>>
  readonly summaries: readonly HybridBenchmarkSummary[]
  readonly gates: readonly HybridBenchmarkGate[]
  readonly runs: readonly HybridBenchmarkRun[]
}

export function createHybridBenchmarkReport({
  runs,
  machine,
  configuration,
}: {
  runs: readonly HybridBenchmarkRun[]
  machine: Readonly<Record<string, string | number>>
  configuration: Readonly<Record<string, string | number>>
}): HybridBenchmarkReport {
  const summaries = (["production", "hybrid-cold", "hybrid-warm"] as const).map(
    (engine) => summarizeEngine(runs.filter((run) => run.engine === engine)),
  )
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    machine,
    configuration,
    summaries: Object.freeze(summaries),
    gates: Object.freeze(evaluateGates(runs)),
    runs: Object.freeze([...runs]),
  })
}

export function renderHybridBenchmarkMarkdown(
  report: HybridBenchmarkReport,
): string {
  const lines = [
    "# Hybrid Transactional Regional Router Benchmark",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "The production rows were completed before any experimental row. All rows use the same prepared SRJ, machine, external relaxed-DRC validation, effort, and per-pass wall limit. Cold and warm experimental results are separate.",
    "",
    "## Configuration",
    "",
    ...Object.entries(report.configuration).map(
      ([name, value]) => `- ${name}: ${value}`,
    ),
    "",
    "## Machine",
    "",
    ...Object.entries(report.machine).map(([name, value]) => `- ${name}: ${value}`),
    "",
    "## Summary",
    "",
    "| Engine | Solved | Zero DRC | Input failures | Algorithm failures | Validation failures | Timeouts | Avg | P50 | P95 | Detailed avg | Finalization avg | Heap avg | RSS avg | Worker util. |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.summaries.map(
      (summary) =>
        `| ${summary.engine} | ${summary.solvedCount}/${summary.sampleCount} (${formatPercent(summary.solveRate)}) | ${summary.zeroDrcCount}/${summary.sampleCount} (${formatPercent(summary.zeroDrcRate)}) | ${summary.inputFailureCount} | ${summary.algorithmicFailureCount} | ${summary.validationFailureCount} | ${summary.timeoutCount} | ${formatMs(summary.averageElapsedMs)} | ${formatMs(summary.p50ElapsedMs)} | ${formatMs(summary.p95ElapsedMs)} | ${formatMs(summary.averageDetailedRoutingMs)} | ${formatMs(summary.averageFinalizationMs)} | ${formatBytes(summary.averagePeakHeapBytes)} | ${formatBytes(summary.averagePeakRssBytes)} | ${summary.averageWorkerUtilization === null ? "n/a" : formatPercent(summary.averageWorkerUtilization)} |`,
    ),
    "",
    "Unsolved and timed-out samples remain in reliability counts and elapsed-time percentiles.",
    "",
    "## Acceptance gates",
    "",
    "| Gate | Result | Evidence |",
    "| --- | --- | --- |",
    ...report.gates.map(
      (gate) =>
        `| ${gate.gate} | ${gate.passed ? "PASS" : "FAIL"} | ${escapeTable(gate.evidence)} |`,
    ),
    "",
    "## Per-sample results",
    "",
    "| Sample | Engine | Status | DRC | Wall | CPU | Detailed | Vias | Length | Bends | Worker util. | Cache H/M | Failure | PNG |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...report.runs.map(
      (run) =>
        `| ${run.scenarioId} | ${run.engine} | ${run.status} | ${run.drcErrorCount ?? "n/a"} | ${formatMs(run.elapsedMs)} | ${formatMs(run.processCpuMs)} | ${formatMs(run.detailedRoutingMs)} | ${run.viaCount ?? "n/a"} | ${run.routedLengthMm === null ? "n/a" : `${run.routedLengthMm.toFixed(2)}mm`} | ${run.bendCount ?? "n/a"} | ${run.workerUtilization === null ? "n/a" : formatPercent(run.workerUtilization)} | ${run.cacheHits === null ? "n/a" : `${run.cacheHits}/${run.cacheMisses}`} | ${escapeTable(run.failureReason ?? "")} | [PNG](${run.pngPath}) |`,
    ),
    "",
    "## Failure details",
    "",
  ]
  const failedRuns = report.runs.filter((run) => run.status !== "solved")
  if (failedRuns.length === 0) {
    lines.push("No failures.")
  } else {
    for (const run of failedRuns) {
      lines.push(
        `- ${run.scenarioId} / ${run.engine}: ${run.status} — ${run.failureReason ?? "no diagnostic"}`,
      )
      for (const message of run.drcErrorMessages) {
        lines.push(`  - DRC: ${message}`)
      }
    }
  }
  lines.push(
    "",
    "## Work counters",
    "",
    "Experimental per-run work counters are preserved in `benchmark-results.json`, including expansions, candidate construction/steps, DRC predicates, spatial queries, bytes transferred/cloned, transactions, stale revalidations, cancellations, region mutations, rebuilds, allocations, memory, cache, vias, length, and bends.",
    "",
  )
  return `${lines.join("\n")}\n`
}

function summarizeEngine(
  runs: readonly HybridBenchmarkRun[],
): HybridBenchmarkSummary {
  const elapsed = runs.map((run) => run.elapsedMs).sort((a, b) => a - b)
  const workerUtilization = runs.flatMap((run) =>
    run.workerUtilization === null ? [] : [run.workerUtilization],
  )
  return Object.freeze({
    engine: runs[0]?.engine ?? "production",
    sampleCount: runs.length,
    solvedCount: countStatus(runs, "solved"),
    zeroDrcCount: runs.filter((run) => run.zeroDrc === true).length,
    inputFailureCount: countStatus(runs, "input-failure"),
    algorithmicFailureCount: countStatus(runs, "algorithmic-failure") + countStatus(runs, "partial"),
    validationFailureCount: countStatus(runs, "validation-failure"),
    timeoutCount: countStatus(runs, "timeout"),
    solveRate: fraction(countStatus(runs, "solved"), runs.length),
    zeroDrcRate: fraction(
      runs.filter((run) => run.zeroDrc === true).length,
      runs.length,
    ),
    averageElapsedMs: average(elapsed),
    p50ElapsedMs: percentile(elapsed, 0.5),
    p95ElapsedMs: percentile(elapsed, 0.95),
    averageDetailedRoutingMs: average(
      runs.map((run) => run.detailedRoutingMs),
    ),
    averageFinalizationMs: average(runs.map((run) => run.finalizationMs)),
    averagePeakHeapBytes: average(runs.map((run) => run.peakHeapBytes)),
    averagePeakRssBytes: average(runs.map((run) => run.peakRssBytes)),
    averageWorkerUtilization:
      workerUtilization.length === 0 ? null : average(workerUtilization),
  })
}

function evaluateGates(
  runs: readonly HybridBenchmarkRun[],
): HybridBenchmarkGate[] {
  const production = runs.filter((run) => run.engine === "production")
  const cold = runs.filter((run) => run.engine === "hybrid-cold")
  const warm = runs.filter((run) => run.engine === "hybrid-warm")
  const productionByScenario = new Map(
    production.map((run) => [run.scenarioId, run]),
  )
  const coldByScenario = new Map(cold.map((run) => [run.scenarioId, run]))
  const warmByScenario = new Map(warm.map((run) => [run.scenarioId, run]))
  const sharedSolved = cold.filter(
    (run) =>
      run.status === "solved" &&
      productionByScenario.get(run.scenarioId)?.status === "solved",
  )
  const multiRegionShared = sharedSolved.filter((run) =>
    run.categories.includes("large-multi-region"),
  )
  const endToEndSpeedup = ratioAcrossShared({
    experimental: multiRegionShared,
    productionByScenario,
    select: (run) => run.elapsedMs,
  })
  const detailedSpeedup = ratioAcrossShared({
    experimental: multiRegionShared,
    productionByScenario,
    select: (run) => run.detailedRoutingMs,
  })
  const simpleCold = coldByScenario.get("simple-direct")
  const simpleProduction = productionByScenario.get("simple-direct")
  const simpleSlowdown =
    simpleCold?.status === "solved" && simpleProduction?.status === "solved"
      ? simpleCold.elapsedMs / Math.max(simpleProduction.elapsedMs, 1e-9)
      : null
  const viaRegression = sharedSolved.some((run) => {
    const baseline = productionByScenario.get(run.scenarioId)
    return (
      run.viaCount !== null &&
      baseline?.viaCount !== null &&
      baseline?.viaCount !== undefined &&
      run.viaCount > baseline.viaCount
    )
  })
  const deterministicPairs = cold.flatMap((coldRun) => {
    const warmRun = warmByScenario.get(coldRun.scenarioId)
    return coldRun.routeHash && warmRun?.routeHash
      ? [{ cold: coldRun.routeHash, warm: warmRun.routeHash }]
      : []
  })
  const parallelEvidence = cold.some(
    (run) =>
      run.status === "solved" &&
      run.workerCpuMs !== null &&
      run.workerCpuMs > 0 &&
      run.workerUtilization !== null &&
      run.workerUtilization > 0,
  )
  const productionSolveRate = fraction(
    production.filter((run) => run.status === "solved").length,
    production.length,
  )
  const coldSolveRate = fraction(
    cold.filter((run) => run.status === "solved").length,
    cold.length,
  )
  return [
    gate(
      "No accepted hybrid route with external DRC/connectivity failure",
      cold
        .filter((run) => run.status === "solved")
        .every((run) => run.zeroDrc && run.finalConnectivityVerified),
      `${cold.filter((run) => run.status === "solved" && run.zeroDrc).length}/${cold.filter((run) => run.status === "solved").length} accepted cold routes externally clean`,
    ),
    gate(
      "Cold/warm deterministic route hashes",
      deterministicPairs.length > 0 &&
        deterministicPairs.every((pair) => pair.cold === pair.warm),
      `${deterministicPairs.filter((pair) => pair.cold === pair.warm).length}/${deterministicPairs.length} comparable route hashes match`,
    ),
    gate(
      "No lower solve rate than production baseline",
      coldSolveRate >= productionSolveRate,
      `hybrid cold ${formatPercent(coldSolveRate)} vs production ${formatPercent(productionSolveRate)}`,
    ),
    gate(
      "At least 1.5x end-to-end speedup on shared solved multi-region boards",
      endToEndSpeedup !== null && endToEndSpeedup >= 1.5,
      endToEndSpeedup === null
        ? "no shared solved multi-region sample"
        : `${endToEndSpeedup.toFixed(2)}x`,
    ),
    gate(
      "At least 2x detailed-routing speedup",
      detailedSpeedup !== null && detailedSpeedup >= 2,
      detailedSpeedup === null
        ? "no shared solved multi-region detailed stage"
        : `${detailedSpeedup.toFixed(2)}x`,
    ),
    gate(
      "No more than 10% simple-board slowdown",
      simpleSlowdown !== null && simpleSlowdown <= 1.1,
      simpleSlowdown === null
        ? "simple board not solved by both engines"
        : `${simpleSlowdown.toFixed(2)}x hybrid/production wall time`,
    ),
    gate(
      "No via-count regression on shared solved samples",
      sharedSolved.length > 0 && !viaRegression,
      `${sharedSolved.length} shared solved complete-board total(s) compared`,
    ),
    gate(
      "Real parallel work evidence",
      parallelEvidence,
      parallelEvidence
        ? "nonzero worker CPU time and utilization recorded"
        : "no solved cold run recorded nonzero worker CPU and utilization",
    ),
  ]
}

function ratioAcrossShared({
  experimental,
  productionByScenario,
  select,
}: {
  experimental: readonly HybridBenchmarkRun[]
  productionByScenario: ReadonlyMap<string, HybridBenchmarkRun>
  select: (run: HybridBenchmarkRun) => number
}): number | null {
  if (experimental.length === 0) return null
  const baselineTotal = experimental.reduce(
    (total, run) =>
      total + select(productionByScenario.get(run.scenarioId)!),
    0,
  )
  const experimentalTotal = experimental.reduce(
    (total, run) => total + select(run),
    0,
  )
  return experimentalTotal <= 0 ? null : baselineTotal / experimentalTotal
}

function gate(
  gateName: string,
  passed: boolean,
  evidence: string,
): HybridBenchmarkGate {
  return Object.freeze({ gate: gateName, passed, evidence })
}

function countStatus(
  runs: readonly HybridBenchmarkRun[],
  status: HybridBenchmarkRunStatus,
): number {
  return runs.filter((run) => run.status === status).length
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length
}

function percentile(sortedValues: readonly number[], quantile: number): number {
  if (sortedValues.length === 0) return 0
  const index = Math.ceil(sortedValues.length * quantile) - 1
  return sortedValues[Math.max(0, index)]!
}

function fraction(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`
}

function formatBytes(value: number): string {
  return `${(value / (1024 * 1024)).toFixed(1)}MiB`
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ")
}
