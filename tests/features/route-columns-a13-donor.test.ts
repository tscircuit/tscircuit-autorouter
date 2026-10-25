import { expect, test } from "bun:test"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { HighDensitySolverA13WithDrcValidation } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13WithDrcValidation"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import { columnNode, columnRoute } from "../fixtures/routeColumnPoolFixtures"

class BoundedNegotiatedDonor extends HighDensitySolverA13WithDrcValidation {
  override _step(): void {
    super._step()
    if (!this.solved && this.routedCount === 1) {
      this.failed = true
      this.error = "test proposal UNKNOWN after first negotiated commodity"
    }
  }
}
class OtherCommodityDonor extends CachedIntraNodeRouteSolver {
  constructor(node: NodeWithPortPoints, readonly route: HighDensityIntraNodeRoute) {
    super({ nodeWithPortPoints: node, traceWidth: 0.1, viaDiameter: 0.3, cacheProvider: null })
    this.MAX_ITERATIONS = 100_000
  }
  override _step(): void {
    this.solvedRoutes.push(this.route)
    this.failed = true
    this.error = "test proposal UNKNOWN after other commodity"
  }
}
class NegotiatedDonorPortfolio extends PortfolioSingleIntraNodeSolver {
  constructor(readonly node: NodeWithPortPoints, readonly other: HighDensityIntraNodeRoute) {
    super({ nodeWithPortPoints: node, layerCount: 2, obstacles: [], traceWidth: 0.1,
      viaDiameter: 0.3, obstacleMargin: 0.1, routeColumnRecombination: true })
  }
  override getHyperParameterDefs(): ReturnType<PortfolioSingleIntraNodeSolver["getHyperParameterDefs"]> {
    return [{ name: "donor", possibleValues: [
      { HIGH_DENSITY_A13: true, SHUFFLE_SEED: 0 },
      { HIGH_DENSITY_A13: false, SHUFFLE_SEED: 1 },
    ] }]
  }
  override getCombinationDefs(): string[][] {
    return [["donor"]]
  }
  override generateSolver(hyperParameters: { HIGH_DENSITY_A13: boolean }): BoundedNegotiatedDonor | OtherCommodityDonor {
    if (hyperParameters.HIGH_DENSITY_A13) return new BoundedNegotiatedDonor({
      nodeWithPortPoints: this.node, layerCount: 2, obstacles: [],
      traceThickness: 0.1, viaDiameter: 0.3, traceMargin: 0.1,
      cellSizeMm: 0.1, stepMultiplier: 1,
    })
    return new OtherCommodityDonor(this.node, this.other)
  }
}

test("an actual partial A13 path retains original terminals and recombines with another portfolio attempt", (): void => {
  const routes = [-1, 1].map((y, index) => columnRoute(String(index), [{ x: -6, y, z: 0 }, { x: 6, y, z: 0 }]))
  const solver = new NegotiatedDonorPortfolio(columnNode(routes), routes[0]!)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.stats.routeColumnRecombinationSolved).toBe(true)
  expect(solver.stats.routeColumnDonor_a13).toBe(1)
  expect(solver.stats.routeColumnDonor_native).toBe(1)
  expect(solver.stats.routeColumnCrossDonorSolutions).toBe(1)
  const negotiated = solver.supervisedSolvers!.find(({ solver: donor }) => donor instanceof BoundedNegotiatedDonor)!.solver as BoundedNegotiatedDonor
  const raw = negotiated.getUnprojectedRouteColumns()
  expect(raw[0]).toBe(negotiated.getUnprojectedRouteColumns()[0])
  expect(raw[0]!.route[0]!.x).not.toBe(-6)
  for (const route of solver.solvedRoutes) {
    expect(route.route[0]).toMatchObject(routes.find((r) => r.connectionName === route.connectionName)!.route[0]!)
    expect(route.route.at(-1)).toMatchObject(routes.find((r) => r.connectionName === route.connectionName)!.route.at(-1)!)
  }
})
