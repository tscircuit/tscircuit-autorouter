import { expect, test } from "bun:test"
import { renderSameMachineBenchmarkResults } from "../scripts/benchmark/same-machine-results"
import { createThreadComparisonReport } from "./fixtures/threadComparisonReport"

test("thread comparisons display four independent measurements in serial then threaded order", (): void => {
  for (const threads of [2, 4, 8]) {
    const markdown = renderSameMachineBenchmarkResults({
      baseReport: createThreadComparisonReport(1_000, 1),
      prReport: createThreadComparisonReport(2_000, 1),
      threaded: {
        threads,
        baseReport: createThreadComparisonReport(400, threads),
        prReport: createThreadComparisonReport(500, threads),
      },
      baseSha: "a".repeat(40),
      prSha: "b".repeat(40),
      repository: "tscircuit/tscircuit-autorouter",
      runnerName: "test-runner",
    })
    expect(markdown).toContain(
      `| Solver | Metric | Base | PR | Base (${threads}T) | PR (${threads}T) |`,
    )
    expect(markdown).not.toContain("| PR | Delta |")
    expect(markdown).toContain(
      "| Pipeline9 | P50 time | 1.0s | 2.0s | 400ms | 500ms |",
    )
    expect(markdown).toContain(
      "| Pipeline9 | Memory P50 | 1000.0 MiB | 2000.0 MiB | 400.0 MiB | 500.0 MiB |",
    )
    expect(markdown).toContain(
      "| Pipeline9 | Average vias | 10.00 | 20.00 | 4.00 | 5.00 |",
    )
    for (const label of [
      "Base",
      "PR",
      `Base (${threads}T)`,
      `PR (${threads}T)`,
    ]) {
      expect(markdown).toContain(
        `<summary>${label} pipeline stage timings</summary>`,
      )
    }
  }
})
