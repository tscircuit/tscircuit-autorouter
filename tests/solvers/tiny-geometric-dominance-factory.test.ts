import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, getTinyHyperGraphSolverOptions, type TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/selective-rerip-tiny-hyper-graph-solver"
import { createGeometricRegionalDiagnostics, installGeometricRegionalDominance } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installGeometricRegionalDominance"
import { createGeometricFixture } from "../fixtures/tiny-geometric-dominance-fixture"

type Factory = { createGreedyFinalRouteSolver(options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver }

test("native completion children receive geometric operator before synchronous solve and custom greedy scoring stays excluded", (): void => {
  const fixture = createGeometricFixture()
  const native = new SelectiveReripTinyHyperGraphSolver(fixture.topology, fixture.problem)
  const optimized = new SelectiveReripTinyHyperGraphSolver(fixture.topology, fixture.problem)
  const counters = createGeometricRegionalDiagnostics()
  const original = TinyHyperGraphSolver.prototype.computeG
  installGeometricRegionalDominance(optimized as unknown as TinyHyperGraphSolver, counters, true)
  for (const attempt of [-1, 0]) {
    const options = getTinyHyperGraphSolverOptions(native)
    const left = (native as unknown as Factory).createGreedyFinalRouteSolver(options, attempt)
    const right = (optimized as unknown as Factory).createGreedyFinalRouteSolver(options, attempt)
    expect(right.constructor).toBe(left.constructor)
    expect(right.computeG).toBe(left.computeG)
    expect(getTinyHyperGraphSolverOptions(right)).toEqual(getTinyHyperGraphSolverOptions(left))
  }
  expect(counters.coneInstalledSolvers).toBe(2)
  expect(counters.coneCustomSolvers).toBe(1)
  expect(TinyHyperGraphSolver.prototype.computeG).toBe(original)
})
