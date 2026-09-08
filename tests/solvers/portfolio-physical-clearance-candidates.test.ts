import { expect, test } from "bun:test"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { createPhysicalPortfolioParams } from "./fixtures/createPhysicalPortfolioParams"

test("physical clearance selects only the existing native portfolio combinations before routing", (): void => {
  const params = createPhysicalPortfolioParams()
  const solver = new PortfolioSingleIntraNodeSolver(params)
  expect(solver.getCombinationDefs()).toEqual([
    ["majorCombinations", "orderings6", "cellSizeFactor"],
    ["noVias"],
    ["orderings50"],
    ["flipTraceAlignmentDirection", "orderings6"],
  ])
  solver.initializeSolvers()
  expect(solver.supervisedSolvers).toHaveLength(63)
  for (const candidate of solver.supervisedSolvers!) {
    expect(candidate.solver).toBeInstanceOf(CachedIntraNodeRouteSolver)
    if (!(candidate.solver instanceof CachedIntraNodeRouteSolver)) {
      throw new Error("Expected a native physical-clearance candidate")
    }
    const context = candidate.solver.physicalClearanceContext
    expect(context?.traceClearanceIndex).toBe(
      params.physicalClearanceContext.traceClearanceIndex,
    )
    expect(context?.viaClearanceIndex).toBe(
      params.physicalClearanceContext.viaClearanceIndex,
    )
    expect(context?.canonicalNetIdByConnectionName.get("signal")).toBe(
      "net-signal",
    )
    expect(candidate.solver.traceWidth).toBe(0.15)
    expect(candidate.solver.viaDiameter).toBe(0.3)
    expect(candidate.solver.layerCount).toBe(2)
    expect(candidate.solver.iterations).toBe(0)
  }
  const legacy = new PortfolioSingleIntraNodeSolver({
    ...params,
    physicalClearanceContext: undefined,
  })
  expect(legacy.getCombinationDefs()).toEqual([
    ["throughObstacle"],
    ["singleLayerNoDifferentRootIntersections"],
    ["multiHeadPolyLine"],
    ["majorCombinations", "orderings6", "cellSizeFactor"],
    ["noVias"],
    ["orderings50"],
    ["flipTraceAlignmentDirection", "orderings6"],
    ["closedFormSingleTrace"],
    ["highDensityA01"],
    ["highDensityA03"],
  ])
})
