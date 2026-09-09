import { expect, test } from "bun:test"
import type { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as FutureCostSolver } from "../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { IntraNodeRouteSolver } from "../lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("direct intra-node users retain live geometry unless they select spatial search", () => {
  const nodeWithPortPoints = {
    capacityMeshNodeId: "future-point-contract",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    portPoints: Array.from({ length: 12 }, (_, i) => ({
      connectionName: `connection-${i >> 1}`,
      x: i % 2 ? 4 : -4,
      y: -3 + (i >> 1),
      z: 0,
    })),
  }
  const direct = new IntraNodeRouteSolver({ nodeWithPortPoints })
  direct.step()
  const child = direct.activeSubSolver!
  const replacement = { x: 0.125, y: 0.25, z: 0 }
  const futureChild = child as FutureCostSolver
  futureChild.futureConnectionPoints = [replacement]
  expect(
    futureChild.getClosestFutureConnectionPoint({
      ...replacement,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    }),
  ).toBe(replacement)
  const portfolio = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints })
  expect(portfolio.generateSolver({}).futurePointSearch).toBe("spatial")
  const linearPortfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints,
    futurePointSearch: "linear",
  })
  expect(linearPortfolio.generateSolver({}).futurePointSearch).toBe("linear")
})
