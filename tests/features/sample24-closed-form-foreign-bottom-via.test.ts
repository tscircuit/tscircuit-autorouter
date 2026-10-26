import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import fixture from "../fixtures/sample24-closed-form-foreign-bottom-via.json"

test("the actual C74 foreign-bottom via is rejected before any portfolio family publishes it", (): void => {
  const params = {
    nodeWithPortPoints: structuredClone(fixture.node),
    obstacles: [structuredClone(fixture.obstacle)],
    layerCount: fixture.layerCount,
    allowBlindAndBuriedVias: fixture.allowBlindAndBuriedVias,
    traceWidth: fixture.traceWidth,
    viaDiameter: fixture.viaDiameter,
    viaHoleDiameter: fixture.viaHoleDiameter,
    obstacleMargin: fixture.obstacleMargin,
  }
  const portfolio = new PortfolioSingleIntraNodeSolver(params)
  const candidate = portfolio.generateSolver({ CLOSED_FORM_SINGLE_TRANSITION: true })
  const route = candidate.solvedRoutes[0]!
  expect(route.vias).toEqual([fixture.capturedVia])
  expect(params.nodeWithPortPoints.availableZ).toEqual([0, 1, 2, 3, 4, 5, 6])
  const maximumIterations = portfolio.MAX_ITERATIONS
  const candidateMaximumIterations = candidate.MAX_ITERATIONS
  portfolio.supervisedSolvers = [{ solver: candidate, hyperParameters: {}, f: 0, g: 0, h: 0 }]
  portfolio.step()
  expect(portfolio.solved).toBe(false)
  expect(portfolio.failed).toBe(false)
  expect(portfolio.winningSolver).toBeUndefined()
  expect(portfolio.solvedRoutes).toEqual([])
  expect(candidate.failed).toBe(true)
  expect(candidate.solved).toBe(false)
  expect(candidate.error).toContain("via violates foreign obstacle clearance")
  expect(route.traceThickness).toBe(0.1)
  expect(portfolio.MAX_ITERATIONS).toBe(maximumIterations)
  expect(candidate.MAX_ITERATIONS).toBe(candidateMaximumIterations)
  expect(candidate.iterations).toBe(0)

  // The original A01/A03 APIs do not receive board obstacles. Their output must
  // pass the same acceptance point as the closed form, without running a grid.
  for (const Solver of [HighDensitySolverA01, HighDensitySolverA03]) {
    const owner = new PortfolioSingleIntraNodeSolver(params)
    const backend = Object.create(Solver.prototype)
    Object.assign(backend, { solved: true, failed: false, iterations: 0, MAX_ITERATIONS: 12345, step: (): void => {}, getOutput: (): HighDensityIntraNodeRoute[] => [route] })
    owner.supervisedSolvers = [{ solver: backend, hyperParameters: {}, f: 0, g: 0, h: 0 }]
    owner.step()
    expect(owner.solved).toBe(false)
    expect(owner.winningSolver).toBeUndefined()
    expect(owner.solvedRoutes).toEqual([])
    expect(backend.failed).toBe(true)
    expect(backend.MAX_ITERATIONS).toBe(12345)
  }

  // A legal alternative may leave the local rectangle; this fix imposes no
  // new node-boundary rule and lets the existing portfolio accept that result.
  const alternative = portfolio.generateSolver({ CLOSED_FORM_SINGLE_TRANSITION: true })
  const via = { x: 170.9, y: fixture.capturedVia.y }
  alternative.solvedRoutes = [{ ...route, route: [route.route[0]!, { ...via, z: 4 }, { ...via, z: 0 }, route.route.at(-1)!], vias: [via] }]
  portfolio.supervisedSolvers.push({ solver: alternative, hyperParameters: {}, f: 0, g: 0, h: 0 })
  portfolio.step()
  expect(portfolio.solved).toBe(true)
  expect(portfolio.failed).toBe(false)
  expect(portfolio.winningSolver).toBe(alternative)
  expect(portfolio.solvedRoutes[0]!.vias).toEqual([via])
  expect(params.nodeWithPortPoints).toEqual(fixture.node)
  expect(params.obstacles).toEqual([fixture.obstacle])
})
