/*
 * Owned experimental kernel adapted from @tscircuit/high-density-a01 0.0.36
 * (10cdce5ad). Native occupancy/rip rules remain frozen within each query.
 *
 * MIT License
 *
 * Copyright (c) 2026 tscircuit
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
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
