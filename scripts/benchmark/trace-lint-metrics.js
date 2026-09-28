/** @type {Record<string, string>} */
export const TRACE_LINT_LABELS = { odd_angle: "Avg Angled Traces" }

/**
 * @param {...(import('./benchmark-types').SolverRunSummary | undefined)[]} summaries
 * @returns {string[]}
 */
export const getTraceLintTypes = (...summaries) => {
  const types = new Set(Object.keys(TRACE_LINT_LABELS))
  for (const summary of summaries) {
    for (const type of Object.keys(summary?.avgTraceLintIssues ?? {})) {
      types.add(type)
    }
  }
  return [...types].sort()
}

/**
 * Missing historical measurements are unknown, not zero style errors.
 * @param {import('./benchmark-types').WorkerResult[]} results
 * @returns {Record<string, number | null>}
 */
export const averageTraceLintIssues = (results) => {
  const completed = results.filter(
    (result) => result.didSolve && !result.didTimeout,
  )
  const types = new Set(Object.keys(TRACE_LINT_LABELS))
  for (const result of completed) {
    for (const type of Object.keys(result.traceLintIssueCounts ?? {})) {
      types.add(type)
    }
  }
  return Object.fromEntries(
    [...types].map((type) => {
      const counts = completed.flatMap((result) => {
        const count = result.traceLintIssueCounts?.[type]
        if (count === undefined) return []
        if (!Number.isInteger(count) || count < 0) {
          throw new Error(`Invalid trace lint count for ${type}`)
        }
        return [count]
      })
      return [
        type,
        counts.length
          ? counts.reduce((sum, count) => sum + count, 0) / counts.length
          : null,
      ]
    }),
  )
}

/**
 * Keep the console artifact readable with one metric row per issue type.
 * @param {import('./benchmark-types').SolverRunSummary[]} summaries
 * @returns {string}
 */
export const formatTraceLintTable = (summaries) => {
  const rows = getTraceLintTypes(...summaries).map((type) => {
    const values = summaries.map((summary) => {
      const value = summary.avgTraceLintIssues?.[type]
      return typeof value === "number" ? value.toFixed(2) : "n/a"
    })
    return `| ${TRACE_LINT_LABELS[type] ?? `Avg ${type}`} | ${values.join(" | ")} |`
  })
  return [
    `| Style errors | ${summaries.map((summary) => summary.solverName).join(" | ")} |`,
    `| --- | ${summaries.map(() => "---:").join(" | ")} |`,
    ...rows,
  ].join("\n")
}
