import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { createLazyPortfolioNode, policySnapshot } from "./lazyPortfolioTestUtils"

class A03TopologyPortfolio extends PortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] {
    return [["highDensityA03"]]
  }
}

test("deterministic modes retain legacy A03 proposals and nominal-covered final copper widths", (): void => {
  for (const traceWidth of [0.15, 0.2]) {
    const node = createLazyPortfolioNode(2)
    const params = { nodeWithPortPoints: node, traceWidth, viaDiameter: 0.3,
      cacheProvider: null, captureSearchDebug: false }
    const legacy = new A03TopologyPortfolio({ ...params, portfolioMode: "legacy" })
    legacy.solve()
    expect(legacy.solved).toBe(true)
    expect(legacy.winningSolver instanceof HighDensitySolverA03).toBe(true)
    expect(legacy.solvedRoutes).toHaveLength(2)
    expect(legacy.solvedRoutes.every((route) => route.traceThickness === 0.1)).toBe(true)
    for (const portfolioMode of ["eager", "lazy"] as const) {
      const actual = new A03TopologyPortfolio({ ...params, portfolioMode })
      actual.solve()
      expect(actual.solved).toBe(true)
      expect(actual.failed).toBe(false)
      expect(actual.winningSolver instanceof HighDensitySolverA03).toBe(true)
      expect(policySnapshot(actual)).toEqual(policySnapshot(legacy))
      expect(JSON.stringify(actual.solvedRoutes)).toBe(JSON.stringify(legacy.solvedRoutes))
      const widths = new TraceWidthSolver({
        hdRoutes: actual.solvedRoutes, minTraceWidth: 0.15, layerCount: 2,
        connection: [0, 1].map((index) => ({ name: `connection-${index}`,
          nominalTraceWidth: 0.2, pointsToConnect: [] })),
      })
      widths.solve()
      expect(widths.solved).toBe(true)
      const finalRoutes = widths.getHdRoutesWithWidths()
      expect(finalRoutes).toHaveLength(2)
      for (const route of finalRoutes) {
        expect(route.traceThickness).toBe(0.2)
        expect(route.route.every((point) => point.traceThickness === 0.2)).toBe(true)
        const finalWires = convertHdRouteToSimplifiedRoute(route, 2)
          .filter((point) => point.route_type === "wire")
        expect(finalWires.length).toBeGreaterThan(1)
        expect(finalWires.every((point) => point.width === 0.2 && point.width >= 0.15)).toBe(true)
      }
    }
  }
})
