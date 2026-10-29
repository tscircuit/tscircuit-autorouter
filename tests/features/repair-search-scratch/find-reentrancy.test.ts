import { expect, test } from "bun:test"
import { FindClearancePathSolver as NativeFind, type ClearancePathInput } from "@tscircuit/repair04"
import { FindClearancePathSolver } from "lib/solvers/RepairSearchScratch/native/FindClearancePathSolver"
import { createRepairSearchScratchStats } from "lib/solvers/RepairSearchScratch/RepairSearchScratchStats"
import { pathInput } from "../../fixtures/repair04StepFixtures"
import { runStepParity } from "../../fixtures/repair-search-scratch/stepParity"

test("same-solver nested search callbacks use independent neighbor frames and retain native scheduling", (): void => {
  const ledger = createRepairSearchScratchStats()
  const make = (candidate: boolean): { solver: NativeFind | FindClearancePathSolver; nested: () => number } => {
    let solver: NativeFind | FindClearancePathSolver, nested = 0
    const input: ClearancePathInput = {
      ...structuredClone(pathInput), maxNodes: 1200, gridSize: 0.1,
      getAdditionalEdgeCost: (): number => {
        const phase = (solver as unknown as { phase: string }).phase
        if (phase === "search" && nested === 0) {
          nested++
          solver.step()
        }
        return 0
      },
    }
    solver = candidate ? new FindClearancePathSolver(input, undefined, ledger) : new NativeFind(input)
    return { solver, nested: () => nested }
  }
  const reference = make(false), candidate = make(true)
  runStepParity(reference.solver, candidate.solver)
  expect(reference.nested()).toBe(1)
  expect(candidate.nested()).toBe(1)
  expect(ledger.neighborScratchBuffersCreated).toBe(2)
})
