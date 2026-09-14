type Candidate = {
  constructor: { name: string }
  iterations: number
  MAX_ITERATIONS: number
  solved: boolean
  failed: boolean
  error: string | null
  stats: Record<string, unknown>
}

type CandidateTiming = {
  constructionMs: number
  setupMs: number
  steppingMs: number
}

export const routingDiagnostics: {
  emit?: (event: Record<string, unknown>) => void
  timing: WeakMap<object, CandidateTiming>
} = { timing: new WeakMap() }

export function recordCandidateTiming(
  solver: object,
  timing: Partial<CandidateTiming>,
): void {
  if (!routingDiagnostics.emit) return
  const previous = routingDiagnostics.timing.get(solver) ?? {
    constructionMs: 0,
    setupMs: 0,
    steppingMs: 0,
  }
  for (const key of ["constructionMs", "setupMs", "steppingMs"] as const) {
    previous[key] += timing[key] ?? 0
  }
  routingDiagnostics.timing.set(solver, previous)
}

export function describeCandidate(solver: Candidate): Record<string, unknown> {
  return {
    solver: solver.constructor.name,
    iterations: solver.iterations,
    maxIterations: solver.MAX_ITERATIONS,
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    stats: solver.stats,
    ...routingDiagnostics.timing.get(solver),
  }
}
