import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import type { BenchmarkReport, WorkerResult } from "./benchmark-types"

type EffortRun = { effort: number; report: BenchmarkReport }

export function renderEffortComparison(runs: EffortRun[]): string {
  const baseline = runs[0].report.tests
  const key = (result: WorkerResult): string =>
    `${result.solverName}:${result.scenarioName}`
  const matched = baseline.filter((result) =>
    runs.every(({ report }) =>
      report.tests.some(
        (other) =>
          key(other) === key(result) &&
          other.didSolve &&
          other.relaxedDrcPassed &&
          other.viaCount !== undefined,
      ),
    ),
  )
  const keys = new Set(matched.map(key))
  const lines = [
    "## Dataset18 effort comparison",
    "",
    "Same commit and runner; pipeline 9; 1x, 1.5x, and 2x cleanup effort. Per-sample timeouts: 360s, 540s, and 720s.",
    `Via totals use only the ${matched.length} samples solved with relaxed DRC passing at every effort. Failures and timeouts remain visible below.`,
    "",
    "| Effort | Solved | DRC passing | Timeouts | Matched vias | Via change vs 1x | Matched runtime (s) |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ]
  let baselineVias = 0
  for (const { effort, report } of runs) {
    const paired = report.tests.filter((result) => keys.has(key(result)))
    const vias = paired.reduce((sum, result) => sum + result.viaCount!, 0)
    if (effort === 1) baselineVias = vias
    lines.push(
      `| ${effort}x | ${report.tests.filter((r) => r.didSolve).length}/${report.tests.length} | ${report.tests.filter((r) => r.didSolve && r.relaxedDrcPassed).length}/${report.tests.length} | ${report.tests.filter((r) => r.didTimeout).length} | ${matched.length ? vias : "n/a"} | ${matched.length ? vias - baselineVias : "n/a"} | ${(paired.reduce((sum, r) => sum + r.elapsedTimeMs, 0) / 1000).toFixed(1)} |`,
    )
  }
  lines.push(
    "",
    "Negative via changes mean fewer vias. No matched samples means no conclusion can be drawn.",
    "",
    "### Per-sample matched vias",
    "",
    "| Sample | 1x | 1.5x | 2x |",
    "| --- | --- | --- | --- |",
  )
  for (const result of matched) {
    lines.push(
      `| ${result.sampleNumber} | ${runs.map(({ report }) => report.tests.find((other) => key(other) === key(result))!.viaCount).join(" | ")} |`,
    )
  }
  return lines.join("\n") + "\n"
}

if (import.meta.main) {
  mkdirSync("benchmark-effort", { recursive: true })
  const runs: EffortRun[] = []
  for (const effort of [1, 1.5, 2]) {
    const result = spawnSync(
      "bash",
      [
        "benchmark.sh",
        "--pipeline",
        "9",
        "--dataset",
        "18",
        "--effort",
        String(effort),
        "--sample-timeout",
        `${360 * effort}s`,
        "--concurrency",
        "8",
      ],
      { stdio: "inherit" },
    )
    if (result.error) throw result.error
    if (result.status !== 0)
      throw new Error(`Benchmark ${effort}x exited with ${result.status}`)
    const raw = readFileSync("benchmark-result.json", "utf8")
    writeFileSync(`benchmark-effort/${effort}x.json`, raw)
    runs.push({ effort, report: JSON.parse(raw) as BenchmarkReport })
  }
  writeFileSync("benchmark-effort/comparison.md", renderEffortComparison(runs))
}
