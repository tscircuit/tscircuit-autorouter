/**
 * @param {import("./benchmark-types").BenchmarkReport | null | undefined} report
 * @param {string} label
 * @returns {string[]}
 */
export function renderBenchmarkStageTimings(report, label) {
  const lines = ["", "<details>", `<summary>${label} pipeline stage timings</summary>`, ""]
  const solverNames = new Set((report?.tests ?? []).map((test) => test.solverName))
  if (solverNames.size === 0) lines.push("Stage timings unavailable for this report.", "")
  for (const solverName of solverNames) {
    const tests = report.tests.filter((test) => test.solverName === solverName)
    const timedTests = tests.filter((test) => test.stageTiming !== undefined)
    const totals = new Map()
    let partialCount = 0
    for (const test of timedTests) {
      if (test.stageTiming.status === "partial") partialCount++
      for (const stage of test.stageTiming.stages) {
        totals.set(stage.stageName, (totals.get(stage.stageName) ?? 0) + stage.elapsedTimeMs)
      }
    }
    const totalMs = [...totals.values()].reduce((sum, value) => sum + value, 0)
    // Escape report-provided names before placing them in Markdown or HTML.
    const escapedSolver = solverName.replace(/[&<>|\r\n]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "|": "&#124;", "\r": " ", "\n": " ",
    })[character])
    lines.push(`**${escapedSolver}**`, "")
    if (timedTests.length === 0) {
      lines.push("Stage timings unavailable for this report.", "")
      continue
    }
    lines.push(
      `Recorded timings: ${timedTests.length}/${tests.length} samples (${partialCount} partial, including failed or timed-out samples).`,
      "Times are summed across samples; percentages use the total recorded stage time for this solver.",
      "",
      "| Stage | Total time | % of stage time |",
      "| --- | ---: | ---: |",
    )
    for (const [stageName, elapsedTimeMs] of totals) {
      const escapedStage = stageName.replace(/[&<>|\r\n]/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "|": "&#124;", "\r": " ", "\n": " ",
      })[character])
      const percent = totalMs > 0 ? `${(elapsedTimeMs / totalMs * 100).toFixed(1)}%` : "n/a"
      lines.push(`| ${escapedStage} | ${(elapsedTimeMs / 1000).toFixed(3)}s | ${percent} |`)
    }
    lines.push(`| **Total** | **${(totalMs / 1000).toFixed(3)}s** | **${totalMs > 0 ? "100.0%" : "n/a"}** |`, "")
  }
  lines.push("</details>")
  return lines
}
