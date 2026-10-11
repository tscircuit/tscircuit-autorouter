import { expect, test } from "bun:test"
import { FindClearancePathSolver } from "@tscircuit/repair04"
import { Pipeline9DenseClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/Pipeline9DenseClearancePathSolver"
import { pathInput } from "../fixtures/repair04StepFixtures"

test("packed path work preserves synchronous cost geometry and independent public callback points", (): void => {
  let found = 0
  for (const heuristicWeight of [1, 3]) {
    for (const maxNodes of [32, 12000]) {
      const retained = new Map<object, string>()
      const cost = (a: typeof pathInput.start, b: typeof pathInput.end): number =>
        Math.abs((a.x + b.x) / 2) < 1 && (a.y + b.y) / 2 < .2 ? .025 : 0
      const input = { ...pathInput, routes: [pathInput.routes[0]!], maxNodes, heuristicWeight, getAdditionalEdgeCost: cost }
      const baseline = new FindClearancePathSolver(input)
      const scratch = new Pipeline9DenseClearancePathSolver({ ...input, synchronousEdgeCosts: true })
      const publicCallback = new Pipeline9DenseClearancePathSolver({ ...input, getAdditionalEdgeCost: (a, b): number => {
        if (!retained.has(a)) retained.set(a, JSON.stringify(a))
        if (!retained.has(b)) retained.set(b, JSON.stringify(b))
        return cost(a, b)
      } })
      while (!baseline.solved && !baseline.failed) {
        baseline.step()
        scratch.step()
        publicCallback.step()
        expect(scratch.stats).toEqual(baseline.stats)
        expect(publicCallback.stats).toEqual(baseline.stats)
        expect(scratch.solved).toBe(baseline.solved)
        expect(publicCallback.solved).toBe(baseline.solved)
      }
      expect(scratch.getOutput()).toEqual(baseline.getOutput())
      expect(publicCallback.getOutput()).toEqual(baseline.getOutput())
      expect(scratch.iterations).toBe(baseline.iterations)
      expect(publicCallback.iterations).toBe(baseline.iterations)
      expect([...retained].every(([point, snapshot]) => JSON.stringify(point) === snapshot)).toBe(true)
      expect(retained.size).toBeGreaterThan(0)
      if (baseline.getOutput()) found++
    }
  }
  expect(found).toBeGreaterThan(0)
  const exception = new RangeError("original edge-cost invariant")
  const invalid = { ...pathInput, routes: [pathInput.routes[0]!],
    getAdditionalEdgeCost: (): number => { throw exception } }
  for (const solver of [new FindClearancePathSolver(invalid), new Pipeline9DenseClearancePathSolver(invalid),
    new Pipeline9DenseClearancePathSolver({ ...invalid, synchronousEdgeCosts: true })]) {
    let received: unknown
    try { while (!solver.solved && !solver.failed) solver.step() }
    catch (error: unknown) { received = error }
    expect(received).toBe(exception)
    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(true)
  }
})
