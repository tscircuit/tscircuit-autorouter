import { expect, test } from "bun:test"
import { denseEventOracle, emptyEventInput, runEventQuery } from "./eventTileTestUtils"

test("event costs and reachability agree with an independent dense oracle on varying physical fields", () => {
  let seed = 893421
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  for (let trial = 0; trial < 500; trial++) {
    const cols = 3 + Math.floor(random() * 5)
    const rows = 3 + Math.floor(random() * 4)
    const layers = 1 + Math.floor(random() * 3)
    const plane = cols * rows
    const input = emptyEventInput(cols, rows, layers)
    for (let xy = 0; xy < plane; xy++) {
      input.viaCost[xy] = random() < 0.4 ? 3 : 0
      input.viaHistory[xy] = random() < 0.2 ? 0.25 : 0
      input.viaAllowed[xy] = Number(random() > 0.25)
      input.fixedVia[xy] = Number(random() < 0.1)
    }
    for (let index = 0; index < plane * layers; index++) {
      input.fixed[index] = Number(random() < 0.1)
      input.traceCost[index] = random() < 0.3 ? 2 : 0
      input.history[index] = random() < 0.2 ? 0.6 : 0
    }
    const start = Math.floor(random() * plane * layers)
    const goal = Math.floor(random() * plane * layers)
    const oracle = denseEventOracle(input, cols, rows, layers, start, goal, 0.7, 0.2, 0.3)
    const result = runEventQuery(input, cols, rows, layers, start, goal, 0.7, 0.2, 0.3)
    if (Number.isFinite(oracle)) expect(result.cost).toBeCloseTo(oracle, 10)
    else expect(result.cost).toBe(Infinity)
  }
})
