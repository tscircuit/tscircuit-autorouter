import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { detailedPriority, priorityParams } from "../priorityDagTestUtils"

test("eligible owned portfolios replace their grid families and sparse routes pass original physical acceptance", (): void =>
  detailedPriority((): void => {
    const params = priorityParams()
    const portfolio = new PortfolioSingleIntraNodeSolver({
      ...params,
      priorityDagSearch: true,
      sparsePhysicalSearch: true,
    })
    expect(portfolio.getCombinationDefs()).toEqual([
      ["throughObstacle"],
      ["singleLayerNoDifferentRootIntersections"],
      ["sparsePhysical"],
    ])
    const generic = new PortfolioSingleIntraNodeSolver(params)
    expect(
      generic
        .getCombinationDefs()
        .some((combination): boolean => combination.includes("highDensityA01")),
    ).toBe(true)
    const solver = new PriorityDagIntraNodeSolver({
      ...params,
      sparsePhysicalSearch: true,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.priorityDiagnostics.prioritySparseSearches).toBeGreaterThan(0)
    expect(solver.priorityDiagnostics.prioritySparseWork).toBeGreaterThan(0)
    expect(
      solver.priorityDiagnostics.priorityFinalSegmentChecks,
    ).toBeGreaterThan(0)
    expect(solver.solvedRoutes).toHaveLength(3)
    for (let i = 0; i < solver.solvedRoutes.length; i++) {
      for (let j = i + 1; j < solver.solvedRoutes.length; j++) {
        expect(
          doPipeline9RoutesHaveCopperConflict({
            left: solver.solvedRoutes[i],
            right: solver.solvedRoutes[j],
            clearance: 0.1,
            layerCount: 2,
          }),
        ).toBe(false)
      }
    }
  }))
