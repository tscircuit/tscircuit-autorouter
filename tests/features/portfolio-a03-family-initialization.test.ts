import { HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { expect, spyOn, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { raceNode } from "../fixtures/hdFamilyRace"

test("A03 family selection initializes inside BaseSolver's first step and preserves the ordinary supervisor budget", (): void => {
  const params = {
    nodeWithPortPoints: raceNode,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    rejectOverlappingTerminals: true,
  }
  const ordinary = new PortfolioSingleIntraNodeSolver(params)
  ordinary.MIN_SUBSTEPS = 1
  ordinary.step()
  const selected = new PortfolioSingleIntraNodeSolver(params)
  selected.MIN_SUBSTEPS = 1
  const initialize = selected.initializeSolvers.bind(selected)
  let initializationIteration = -1
  selected.initializeSolvers = (): void => {
    initializationIteration = selected.iterations
    initialize()
  }
  expect(selected.getPreferredFamilyState()).toEqual({
    status: "uninitialized",
    iterations: 0,
    won: false,
  })
  expect(initializationIteration).toBe(-1)
  expect(selected.stepPreferredFamily()).toBe(1)
  const native = selected.supervisedSolvers!.find(
    ({ solver }) => solver instanceof HighDensitySolverA03,
  )!.solver
  const reference = ordinary.supervisedSolvers!.find(
    ({ solver }) => solver instanceof HighDensitySolverA03,
  )!.solver
  expect(initializationIteration).toBe(1)
  expect(selected.iterations).toBe(1)
  expect(selected.MAX_ITERATIONS).toBe(ordinary.MAX_ITERATIONS)
  expect(native.MAX_ITERATIONS).toBe(reference.MAX_ITERATIONS)
  expect(native.iterations).toBe(1)
  expect(selected["advancingPreferredFamily"]).toBe(false)

  const failing = new PortfolioSingleIntraNodeSolver(params)
  failing.initializeSolvers = (): never => {
    throw new Error("expected family setup failure")
  }
  const logging = spyOn(console, "error").mockImplementation((): void => {})
  try {
    expect(() => failing.stepPreferredFamily()).toThrow(
      "expected family setup failure",
    )
  } finally {
    logging.mockRestore()
  }
  expect(failing.failed).toBe(true)
  expect(failing["advancingPreferredFamily"]).toBe(false)
})
