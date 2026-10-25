import { expect, test } from "bun:test"
import { denseEventOracle, emptyEventInput, runEventQuery } from "./eventTileTestUtils"

test("compressed multilayer rectangle partitions preserve arbitrary interior terminal projections and additive costs", (): void => {
  let seed = 93472911
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  let compressed = 0
  for (let trial = 0; trial < 120; trial++) {
    const cols = 11 + Math.floor(random() * 6)
    const rows = 11 + Math.floor(random() * 6)
    const layers = 1 + Math.floor(random() * 3)
    const plane = cols * rows
    const input = emptyEventInput(cols, rows, layers)
    const width = Math.ceil(cols / 5)
    const height = Math.ceil(rows / 5)
    const planeFields = Array.from({ length: width * height }, () => ({
      cost: Math.floor(random() * 4),
      history: random() < 0.4 ? 0.35 : 0,
      allowed: Number(random() > 0.3),
      fixed: Number(random() < 0.15),
    }))
    const layerFields = Array.from({ length: width * height * layers }, () => ({
      cost: Math.floor(random() * 3),
      history: random() < 0.4 ? 0.45 : 0,
      fixed: Number(random() < 0.15),
    }))
    for (let layer = 0; layer < layers; layer++) {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const xy = row * cols + col
          const block = Math.floor(row / 5) * width + Math.floor(col / 5)
          const via = planeFields[block]!
          const trace = layerFields[layer * width * height + block]!
          input.viaCost[xy] = via.cost
          input.viaHistory[xy] = via.history
          input.viaAllowed[xy] = via.allowed
          input.fixedVia[xy] = via.fixed
          input.traceCost[layer * plane + xy] = trace.cost
          input.history[layer * plane + xy] = trace.history
          input.fixed[layer * plane + xy] = trace.fixed
        }
      }
    }
    const start = Math.floor(random() * plane * layers)
    const goal = Math.floor(random() * plane * layers)
    const expected = denseEventOracle(input, cols, rows, layers, start, goal, 0.8, 0.13, 0.19)
    const actual = runEventQuery(input, cols, rows, layers, start, goal, 0.8, 0.13, 0.19)
    if (Number.isFinite(expected)) expect(actual.cost).toBeCloseTo(expected, 10)
    else expect(actual.cost).toBe(Infinity)
    compressed += actual.kernel.diagnostics.compressedQueries
  }
  expect(compressed).toBe(120)
})
