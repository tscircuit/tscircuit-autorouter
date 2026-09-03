import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { makeNode } from "./never-fail-growth-high-density/test-helpers"

const makePortfolio = (nodeWithPortPoints = makeNode()) => {
  const solver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    obstacles: [],
    layerCount: 2,
    useHighDensitySolverA11: true,
    useHighDensitySolverA12: true,
  })
  solver.initializeSolvers()
  return solver
}

const getNativeGridCandidates = (solver: PortfolioSingleIntraNodeSolver) => ({
  a01Candidate: solver.supervisedSolvers?.find(
    ({ hyperParameters }) =>
      hyperParameters.HIGH_DENSITY_A01 && hyperParameters.SHUFFLE_SEED === 0,
  ),
  a11Candidate: solver.supervisedSolvers?.find(
    ({ solver: candidate }) =>
      candidate.getSolverName() === "HighDensitySolverA11",
  ),
  a12Candidate: solver.supervisedSolvers?.find(
    ({ solver: candidate }) =>
      candidate.getSolverName() === "HighDensitySolverA12",
  ),
})

test("native A11 and A12 stay lazy on sparse nodes and prioritized on congested nodes", () => {
  const sparsePortfolio = makePortfolio()
  const {
    a01Candidate: sparseA01Candidate,
    a11Candidate: sparseA11Candidate,
    a12Candidate: sparseA12Candidate,
  } = getNativeGridCandidates(sparsePortfolio)

  expect(sparseA11Candidate?.solver.MAX_ITERATIONS).toBe(5_000)
  expect(sparseA12Candidate?.solver.MAX_ITERATIONS).toBe(15_000)
  expect(sparseA11Candidate!.f).toBeGreaterThan(sparseA01Candidate!.f)
  expect(sparseA12Candidate!.f).toBeGreaterThan(sparseA01Candidate!.f)

  sparsePortfolio.step()
  expect(sparsePortfolio.activeSubSolver).not.toBe(sparseA11Candidate?.solver)
  expect(sparsePortfolio.activeSubSolver).not.toBe(sparseA12Candidate?.solver)
  expect(sparseA11Candidate?.solver.iterations).toBe(0)
  expect(sparseA12Candidate?.solver.iterations).toBe(0)

  const sparseNode = makeNode()
  const denseNode = {
    ...sparseNode,
    portPoints: Array.from({ length: 10 }, (_, index) => ({
      connectionName: `connection-${Math.floor(index / 2)}`,
      x: index % 2 === 0 ? 9.5 : 10.5,
      y: 20,
      z: 0,
    })),
  }
  const congestedPortfolio = makePortfolio(denseNode)
  const {
    a01Candidate: congestedA01Candidate,
    a11Candidate: congestedA11Candidate,
    a12Candidate: congestedA12Candidate,
  } = getNativeGridCandidates(congestedPortfolio)

  expect(congestedA11Candidate?.solver.MAX_ITERATIONS).toBe(100_000)
  expect(congestedA11Candidate?.f).toBe(congestedA01Candidate?.f)
  expect(congestedA12Candidate?.f).toBe(congestedA01Candidate?.f)
  expect(congestedPortfolio.computeG(congestedA11Candidate!.solver)).toBe(
    congestedPortfolio.computeG(congestedA01Candidate!.solver),
  )
  expect(congestedPortfolio.computeG(congestedA12Candidate!.solver)).toBe(
    congestedPortfolio.computeG(congestedA01Candidate!.solver),
  )
})
