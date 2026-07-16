import { expect, test } from "bun:test"
import {
  getTinyHyperGraphSectionSolverOptions,
  getTinyHyperGraphSolveGraphOptions,
} from "../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("higher effort extends tiny-hypergraph budgets without repeating rip ramps", () => {
  const lowSolve = getTinyHyperGraphSolveGraphOptions(0.1)
  const normalSolve = getTinyHyperGraphSolveGraphOptions(1)
  const highSolve = getTinyHyperGraphSolveGraphOptions(5)
  const lowSection = getTinyHyperGraphSectionSolverOptions(0.1)
  const normalSection = getTinyHyperGraphSectionSolverOptions(1)
  const highSection = getTinyHyperGraphSectionSolverOptions(5)

  expect(lowSolve.RIP_THRESHOLD_RAMP_ATTEMPTS).toBe(1)
  expect(normalSolve.RIP_THRESHOLD_RAMP_ATTEMPTS).toBe(10)
  expect(highSolve.RIP_THRESHOLD_RAMP_ATTEMPTS).toBe(10)
  expect(highSolve.MAX_ITERATIONS).toBe(5 * normalSolve.MAX_ITERATIONS!)

  expect(lowSection.RIP_THRESHOLD_RAMP_ATTEMPTS).toBe(2)
  expect(normalSection.RIP_THRESHOLD_RAMP_ATTEMPTS).toBe(16)
  expect(highSection.RIP_THRESHOLD_RAMP_ATTEMPTS).toBe(16)
  expect(highSection.MAX_ITERATIONS).toBe(5 * normalSection.MAX_ITERATIONS!)
})
