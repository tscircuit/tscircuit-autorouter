import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import {
  makeNode,
  makeStraightRoute,
} from "../never-fail-growth-high-density/test-helpers"

test("validator rejection retires a provisional winner and preserves the next accepted route", (): void => {
  const node = makeNode()
  let validationCount = 0
  const params = {
    nodeWithPortPoints: node,
    captureSearchDebug: false,
    growShrinkSolutionValidator: (): boolean => ++validationCount > 1,
  }
  const grow = new GrowShrinkHighDensityIntraNodeSolver(params)
  const rejected = new PortfolioSingleIntraNodeSolver(params)
  const candidate = new IntraNodeRouteSolver(params)
  rejected.supervisedSolvers = [
    { hyperParameters: {}, solver: candidate, h: 0, g: 0, f: 0 },
  ]
  rejected.activeSubSolver = candidate
  rejected.winningSolver = candidate
  rejected.solvedRoutes = [makeStraightRoute()]
  rejected.solved = true
  grow.activeSubSolver = rejected

  grow.step()

  expect(grow.solved).toBe(false)
  expect(grow.failed).toBe(false)
  expect(grow.scaleFactor).toBe(2)
  expect(rejected.error).toBe("High-density scale solution rejected by validator")
  expect(rejected.supervisedSolvers).toEqual([])
  expect(rejected.activeSubSolver).toBeNull()
  expect(rejected.winningSolver).toBeUndefined()
  expect(rejected.stats.retiredCandidateCount).toBe(1)

  const accepted = new PortfolioSingleIntraNodeSolver(params)
  const route = makeStraightRoute()
  route.route[0]!.x = 9
  route.route[1]!.x = 11
  accepted.solvedRoutes = [route]
  accepted.solved = true
  accepted.winningSolver = candidate
  grow.activeSubSolver = accepted
  grow.step()

  expect(grow.solved).toBe(true)
  expect(grow.failed).toBe(false)
  expect(grow.error).toBeNull()
  expect(grow.winningSolver).toBe(accepted)
  expect(accepted.winningSolver).toBe(candidate)
  expect(accepted.stats.failedCandidateWorkspacesRetired).toBeUndefined()
  expect(grow.failedSolvers).toEqual([rejected])
  expect(grow.solvedRoutes).toEqual([makeStraightRoute()])
  expect(validationCount).toBe(2)
})
