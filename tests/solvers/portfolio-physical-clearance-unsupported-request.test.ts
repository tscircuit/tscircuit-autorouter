import { expect, test } from "bun:test"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { createPhysicalPortfolioParams } from "./fixtures/createPhysicalPortfolioParams"

test("direct physical-clearance candidate requests reject every unsupported dispatch family", (): void => {
  const solver = new PortfolioSingleIntraNodeSolver(
    createPhysicalPortfolioParams(),
  )
  for (const parameter of [
    "SINGLE_LAYER_NO_DIFFERENT_ROOT_INTERSECTIONS",
    "HIGH_DENSITY_A01",
    "HIGH_DENSITY_A03",
    "CLOSED_FORM_TWO_TRACE_SAME_LAYER",
    "CLOSED_FORM_TWO_TRACE_TRANSITION_CROSSING",
    "CLOSED_FORM_SINGLE_TRANSITION",
    "THROUGH_OBSTACLE",
    "MULTI_HEAD_POLYLINE_SOLVER",
  ]) {
    expect((): void => {
      solver.generateSolver({ [parameter]: true })
    }).toThrow(`physical clearance does not support ${parameter}`)
  }
  expect(
    solver.generateSolver({ HIGH_DENSITY_A01: false, SHUFFLE_SEED: 0 }),
  ).toBeInstanceOf(CachedIntraNodeRouteSolver)
  expect(solver.supervisedSolvers).toBeUndefined()
  expect(solver.iterations).toBe(0)
})
