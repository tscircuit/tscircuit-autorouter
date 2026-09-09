import { expect, spyOn, test } from "bun:test"
import {
  HighDensitySolverA11,
  getRouteGeometryViolationError,
} from "@tscircuit/high-density-a01"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { doRoutesCoverNodePortPointPairsExactlyOnce } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import { makeNode } from "./never-fail-growth-high-density/test-helpers"

test("A11 uses the native portfolio budget and preserves exact physical pairs", (): void => {
  const nodeWithPortPoints = makeNode()
  nodeWithPortPoints.portPoints = ["a", "alias"].flatMap((connectionName) =>
    nodeWithPortPoints.portPoints.map((point) => ({
      ...point,
      connectionName,
      rootConnectionName: "net",
    })),
  )
  const solverParams = {
    nodeWithPortPoints,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    obstacles: [],
    layerCount: 2,
  }
  const portfolio = new PortfolioSingleIntraNodeSolver(solverParams)
  portfolio.initializeSolvers()
  const candidates = portfolio.supervisedSolvers!
  const a11Candidate = candidates.find(
    ({ solver }) => solver instanceof HighDensitySolverA11,
  )!
  const a11 = a11Candidate.solver
  if (!(a11 instanceof HighDensitySolverA11)) {
    throw new Error("The native portfolio must contain A11")
  }
  const a01Candidate = candidates.find(
    ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A01,
  )!
  expect(a11Candidate.f).toBe(a01Candidate.f)
  expect(
    candidates.filter(({ solver }) => solver instanceof HighDensitySolverA11),
  ).toHaveLength(1)
  expect(
    candidates.some(
      ({ solver }) => solver.getSolverName() === "HighDensitySolverA12",
    ),
  ).toBe(false)
  const standalone = new HighDensitySolverA11({
    nodeWithPortPoints,
    viaDiameter: 0.3,
    viaMinDistFromBorder: 0.15,
    traceThickness: 0.15,
    traceMargin: 0.1,
    effort: 1,
    hyperParameters: { shuffleSeed: 0 },
  })
  standalone.setup()
  expect(a11.MAX_ITERATIONS).toBe(standalone.MAX_ITERATIONS)
  expect(Number.isFinite(a11.MAX_ITERATIONS)).toBe(true)
  expect(a11.MAX_ITERATIONS).toBeGreaterThan(0)
  expect(a11.iterations).toBe(0)
  a11.solve()
  expect(a11.solved).toBe(true)
  expect(a11.failed).toBe(false)
  portfolio.onSolve(a11Candidate)
  const routes = portfolio.solvedRoutes
  expect(routes).toHaveLength(1)
  expect(getRouteGeometryViolationError(routes)).toBeNull()
  expect(
    doRoutesCoverNodePortPointPairsExactlyOnce(routes, nodeWithPortPoints),
  ).toBe(true)

  const duplicateOutput = spyOn(a11, "getOutput").mockReturnValueOnce([
    ...routes,
    routes[0]!,
  ])
  expect(() => portfolio.onSolve(a11Candidate)).toThrow("exactly once")
  duplicateOutput.mockRestore()
  expect(
    doRoutesCoverNodePortPointPairsExactlyOnce([], nodeWithPortPoints),
  ).toBe(false)
  const invalidOutput = spyOn(a11, "getOutput").mockReturnValueOnce([
    {
      ...routes[0]!,
      route: [{ ...routes[0]!.route[0]!, x: Number.NaN }],
    },
  ])
  expect(() => portfolio.onSolve(a11Candidate)).toThrow("non-finite")
  invalidOutput.mockRestore()

  // Existing alias repair remains in place for A01/A03.
  a01Candidate.solver.solve()
  expect(a01Candidate.solver.solved).toBe(true)
  portfolio.onSolve(a01Candidate)
  expect(
    new Set(portfolio.solvedRoutes.map((route) => route.connectionName)),
  ).toEqual(new Set(["a", "alias"]))

  const grown = new GrowShrinkHighDensityIntraNodeSolver(solverParams)
  grown.scaleFactor = 2
  grown.step()
  const scaledPortfolio = grown.activeSubSolver ?? grown.winningSolver
  expect(scaledPortfolio).toBeDefined()
  expect(scaledPortfolio!.getCombinationDefs()).toEqual(
    portfolio
      .getCombinationDefs()
      .filter((combination) => !combination.includes("highDensityA11")),
  )
  expect(
    scaledPortfolio!.supervisedSolvers!.some(
      ({ solver }) => solver instanceof HighDensitySolverA11,
    ),
  ).toBe(false)

  // A candidate rejected during setup must not access unallocated route state.
  const invalidNode = makeNode()
  invalidNode.portPoints[0]!.x -= invalidNode.width
  const ineligiblePortfolio = new PortfolioSingleIntraNodeSolver({
    ...solverParams,
    nodeWithPortPoints: invalidNode,
  })
  ineligiblePortfolio.initializeSolvers()
  const rejected = ineligiblePortfolio.supervisedSolvers!.find(
    ({ solver }) => solver instanceof HighDensitySolverA11,
  )!.solver
  expect(rejected.failed).toBe(true)
  ineligiblePortfolio.adaptiveSearchExpanded = true
  expect(ineligiblePortfolio.computeH(rejected)).toBe(1)
})
