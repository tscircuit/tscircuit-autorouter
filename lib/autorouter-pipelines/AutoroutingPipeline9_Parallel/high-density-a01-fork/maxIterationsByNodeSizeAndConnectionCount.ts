/**
 * Worker-only derivative of @tscircuit/high-density-a01 at
 * 44005d6b9dde7d93a3d3a4815b4e7c8c52b59d34 (MIT, see ./LICENSE).
 * Native search, occupancy, queue and output behavior are preserved. The
 * callback-free grid-history worker owns immutable generated geometry; only
 * ordered geometric circle footprints and raw planar heuristics are reused.
 */
export interface MaxIterationsByNodeSizeAndConnectionCountInput {
  planeSize: number
  layers: number
  connectionCount: number
  effort: number
  maxIterations: number
}

export interface MaxIterationsByNodeSizeAndConnectionCountResult {
  maxIterationsIters: number
  baseSearchBudgetIters: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function computeMaxIterationsByNodeSizeAndConnectionCount(
  input: MaxIterationsByNodeSizeAndConnectionCountInput,
): MaxIterationsByNodeSizeAndConnectionCountResult {
  const states = input.planeSize * input.layers
  const connectionCount = input.connectionCount
  const connectionFactor = Math.sqrt(connectionCount)
  const requestedMaxIterations = Math.max(1, input.maxIterations)

  const baseComputedMaxIterations = clamp(
    Math.round(states * (8 + 1.2 * connectionFactor)),
    150_000,
    12_000_000,
  )
  const computedMaxIters = clamp(
    Math.round(baseComputedMaxIterations * input.effort),
    150_000,
    12_000_000,
  )
  const minIterationBudgetIters = clamp(
    Math.round(requestedMaxIterations * 0.2),
    150_000,
    2_000_000,
  )
  const maxIterationsIters = Math.max(
    1,
    Math.min(
      requestedMaxIterations,
      Math.max(minIterationBudgetIters, computedMaxIters),
    ),
  )
  const baseSearchBudgetIters = clamp(
    Math.round(states * (10 + 0.8 * connectionFactor) * input.effort),
    50_000,
    4_000_000,
  )

  return {
    maxIterationsIters,
    baseSearchBudgetIters,
  }
}
