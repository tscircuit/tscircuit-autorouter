import type { SolverRunSummary, WorkerResult } from "./benchmark-types"

export const TRACE_LINT_LABELS: Record<string, string>
export function getTraceLintTypes(
  ...summaries: Array<SolverRunSummary | undefined>
): string[]
export function averageTraceLintIssues(
  results: WorkerResult[],
): Record<string, number | null>
export function formatTraceLintTable(summaries: SolverRunSummary[]): string
