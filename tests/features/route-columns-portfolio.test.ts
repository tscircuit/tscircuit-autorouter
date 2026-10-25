import { expect, test } from "bun:test"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { columnNode, columnRoute } from "../fixtures/routeColumnPoolFixtures"

type NativeParams = ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0]
class PartialDonor extends CachedIntraNodeRouteSolver {
  constructor(params: NativeParams, readonly offered: HighDensityIntraNodeRoute) {
    super({ ...params, cacheProvider: null })
    this.MAX_ITERATIONS = 100_000
  }
  override _step(): void {
    this.solvedRoutes.push(this.offered)
    this.failed = true
    this.error = "bounded donor UNKNOWN after one complete commodity"
  }
}
class TwoDonorPortfolio extends PortfolioSingleIntraNodeSolver {
  constructor(params: ConstructorParameters<typeof PortfolioSingleIntraNodeSolver>[0], readonly donors: HighDensityIntraNodeRoute[]) {
    super(params)
  }
  override getHyperParameterDefs(): ReturnType<PortfolioSingleIntraNodeSolver["getHyperParameterDefs"]> {
    return [{ name: "partial", possibleValues: [
      { HIGH_DENSITY_A13: false, SHUFFLE_SEED: 0 },
      { HIGH_DENSITY_A13: false, SHUFFLE_SEED: 1 },
    ] }]
  }
  override getCombinationDefs(): string[][] {
    return [["partial"]]
  }
  override generateSolver(hyperParameters: { SHUFFLE_SEED: number }): PartialDonor {
    const offered = this.donors[hyperParameters.SHUFFLE_SEED]
    if (!offered) throw new Error("Missing test donor")
    return new PartialDonor(this.constructorParams, offered)
  }
}

test("two separate failed portfolio attempts supply complete commodities and finish the node with conserved allowance", (): void => {
  const routes = [-1, 1].map((y, i) => columnRoute(String(i), [{ x: -4, y, z: 0 }, { x: 4, y, z: 0 }]))
  const diagnostics: Record<string, number> = {}
  const portfolio = new TwoDonorPortfolio({
    nodeWithPortPoints: columnNode(routes), layerCount: 4, obstacles: [],
    traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1,
    routeColumnRecombination: true, priorityDiagnostics: diagnostics,
  }, routes)
  portfolio.solve()
  expect(portfolio.solved).toBe(true)
  expect(portfolio.failed).toBe(false)
  expect(portfolio.supervisedSolvers).toHaveLength(2)
  expect(portfolio.supervisedSolvers!.every(({ solver }) => solver instanceof PartialDonor && solver.failed && solver.solvedRoutes.length === 1)).toBe(true)
  expect(portfolio.solvedRoutes).toEqual(routes)
  expect(portfolio.stats.routeColumnRecombinationSolved).toBe(true)
  expect(diagnostics.routeColumnCrossDonorSolutions).toBe(1)
  expect(diagnostics.routeColumnDonor_native).toBe(2)
  expect(portfolio.supervisedSolvers!.reduce((sum, { solver }) => sum + solver.MAX_ITERATIONS, 0) + portfolio.routeColumnPool!.workLimit).toBe(200_000)
  expect(portfolio.routeColumnPool!.workUnits).toBe(diagnostics.routeColumnWorkUnits!)
  expect(portfolio.routeColumnPool!.workUnits).toBeLessThanOrEqual(portfolio.routeColumnPool!.workLimit)
  const originalNode = columnNode(routes)
  const treeNode = { ...originalNode, portPoints: [...originalNode.portPoints,
    { x: 0, y: 3, z: 0, connectionName: "0", rootConnectionName: "0" }] }
  const disabled = new TwoDonorPortfolio({ nodeWithPortPoints: treeNode, layerCount: 4 }, routes)
  const enabled = new TwoDonorPortfolio({ nodeWithPortPoints: treeNode, layerCount: 4, routeColumnRecombination: true }, routes)
  disabled.initializeSolvers()
  enabled.initializeSolvers()
  expect(enabled.routeColumnPool!.eligible).toBe(false)
  expect(enabled.routeColumnPool!.workLimit).toBe(0)
  expect(enabled.supervisedSolvers!.map(({ solver }) => solver.MAX_ITERATIONS)).toEqual(disabled.supervisedSolvers!.map(({ solver }) => solver.MAX_ITERATIONS))
  expect(enabled.stats.routeColumnPreflightWorkUnits).toBeGreaterThan(0)
  expect(enabled.stats.routeColumnWorkUnits).toBeUndefined()
})
