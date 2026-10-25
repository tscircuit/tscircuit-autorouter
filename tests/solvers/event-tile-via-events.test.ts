import { expect, test } from "bun:test"
import { denseEventOracle, emptyEventInput, runEventQuery } from "./eventTileTestUtils"

test("interior turn and via-cost events survive multilayer contraction and parent reconstruction", (): void => {
  const cols = 21
  const rows = 17
  const layers = 3
  const plane = cols * rows
  const input = emptyEventInput(cols, rows, layers)
  input.viaCost.fill(50)
  input.viaAllowed.fill(0)
  for (let row = 6; row <= 10; row++) {
    for (let col = 8; col <= 12; col++) {
      input.viaAllowed[row * cols + col] = 1
      input.viaCost[row * cols + col] = 0
    }
  }
  const start = 2 * cols
  const goal = 2 * plane + 14 * cols + 20
  const oracle = denseEventOracle(input, cols, rows, layers, start, goal)
  const result = runEventQuery(input, cols, rows, layers, start, goal)
  expect(result.cost).toBeCloseTo(oracle, 9)
  expect(result.kernel.diagnostics.eventStates).toBeLessThan(plane * layers / 2)
  expect(result.kernel.diagnostics.macroExpansions).toBeLessThan(plane * layers / 2)
  expect(result.kernel.diagnostics.reconstructedGridEdges).toBeGreaterThan(1)
  let viaCount = 0
  for (let current = goal; result.parents[current] !== -1; current = result.parents[current]!) {
    const previous = result.parents[current]!
    if (Math.floor(current / plane) !== Math.floor(previous / plane)) {
      viaCount++
      const xy = current % plane
      expect(input.viaAllowed[xy]).toBe(1)
      expect(input.viaCost[xy]).toBe(0)
    }
  }
  expect(viaCount).toBeGreaterThan(0)
})
