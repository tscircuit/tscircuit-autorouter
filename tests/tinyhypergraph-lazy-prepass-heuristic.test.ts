import { expect, spyOn, test } from "bun:test"
import { DuplicateCongestedPortSolver } from "tiny-hypergraph/lib/index"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("lazy prepass preserves duplicate decisions and routed output", (): void => {
  const originalSolve = DuplicateCongestedPortSolver.prototype.solve
  let compared = false
  const solveSpy = spyOn(
    DuplicateCongestedPortSolver.prototype,
    "solve",
  ).mockImplementation(function (this: DuplicateCongestedPortSolver): void {
    expect(this.options.routeSolveOptions?.USE_LAZY_ROUTE_HEURISTIC).toBe(true)
    const eager = new DuplicateCongestedPortSolver(
      structuredClone(this.serializedHyperGraph),
      {
        ...this.options,
        routeSolveOptions: {
          ...this.options.routeSolveOptions,
          USE_LAZY_ROUTE_HEURISTIC: false,
        },
      },
    )
    originalSolve.call(eager)
    originalSolve.call(this)
    expect(this.failed).toBe(false)
    expect(eager.failed).toBe(false)
    expect(this.report).toEqual(eager.report)
    expect(this.getOutput()).toEqual(eager.getOutput())
    compared = true
  })
  try {
    const solver = new TinyHypergraphPortPointPathingSolver(
      structuredClone(input) as ConstructorParameters<
        typeof TinyHypergraphPortPointPathingSolver
      >[0],
    )
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(compared).toBe(true)
  } finally {
    solveSpy.mockRestore()
  }
})
