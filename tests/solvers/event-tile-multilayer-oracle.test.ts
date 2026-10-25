import { expect, test } from "bun:test"
import { denseEventOracle, emptyEventInput, runEventQuery } from "./eventTileTestUtils"

test("event contraction preserves tiny multilayer costs across every fixed-column and via-window mask", (): void => {
  const cols = 4
  const rows = 3
  const layers = 2
  const plane = cols * rows
  let compressed = 0
  for (let fixedMask = 0; fixedMask < 256; fixedMask++) {
    for (let viaMask = 0; viaMask < 16; viaMask++) {
      const input = emptyEventInput(cols, rows, layers)
      for (let layer = 0; layer < layers; layer++) {
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const index = layer * plane + row * cols + col
            input.fixed[index] = (fixedMask >> (layer * cols + col)) & 1
            input.traceCost[index] = layer === 0 ? col % 2 : 0
            input.history[index] = layer === 1 && col === 2 ? 0.3 : 0
            input.viaAllowed[row * cols + col] = (viaMask >> col) & 1
            input.viaCost[row * cols + col] = col === 1 ? 2 : 0
          }
        }
      }
      const goal = plane * layers - 1
      const oracle = denseEventOracle(input, cols, rows, layers, 0, goal)
      const result = runEventQuery(input, cols, rows, layers, 0, goal)
      if (Number.isFinite(oracle)) expect(result.cost).toBeCloseTo(oracle, 10)
      else expect(result.cost).toBe(Infinity)
      compressed += result.kernel.diagnostics.compressedQueries
    }
  }
  expect(compressed).toBeGreaterThan(0)
})
