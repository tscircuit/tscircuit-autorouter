import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, getTinyHyperGraphSolverOptions, type TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/selective-rerip-tiny-hyper-graph-solver"
import { createTinyRegionalBlockDiagnostics, installTinyRegionalBlockPruning } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installTinyRegionalBlockPruning"
import { createTinyRegionalBlockFixture } from "../fixtures/tiny-regional-block-fixture"

type Factory = { createGreedyFinalRouteSolver(options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver }

test("block pruning wraps owned native synchronous completion factories without changing child scoring or global methods", (): void => {
  const fixture = createTinyRegionalBlockFixture()
  const native = new SelectiveReripTinyHyperGraphSolver(fixture.topology, fixture.problem)
  const optimized = new SelectiveReripTinyHyperGraphSolver(fixture.topology, fixture.problem)
  const diagnostics = createTinyRegionalBlockDiagnostics()
  const nativePrototype = TinyHyperGraphSolver.prototype.computeG
  installTinyRegionalBlockPruning(optimized, diagnostics, true)
  for (const attempt of [-1, 0]) {
    const options = getTinyHyperGraphSolverOptions(native)
    const left = (native as unknown as Factory).createGreedyFinalRouteSolver(options, attempt)
    const right = (optimized as unknown as Factory).createGreedyFinalRouteSolver(options, attempt)
    expect(right.constructor).toBe(left.constructor)
    expect(right.computeG).toBe(left.computeG)
    expect(getTinyHyperGraphSolverOptions(right)).toEqual(getTinyHyperGraphSolverOptions(left))
  }
  expect(diagnostics.regionalBlockInstalledSolvers).toBe(2)
  expect(diagnostics.regionalBlockCustomSolvers).toBe(1)
  expect(TinyHyperGraphSolver.prototype.computeG).toBe(nativePrototype)
})
