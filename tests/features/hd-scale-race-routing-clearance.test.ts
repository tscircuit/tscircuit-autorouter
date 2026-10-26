import { HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { raceNode } from "../fixtures/hdFamilyRace"

test("scale eligibility follows requested copper width and the actual native clearance rather than legacy obstacle padding", (): void => {
  for (const [traceWidth, gap, expected] of [
    [0.1, 0.24, false],
    [0.15, 0.24, true],
    [0.05, 0.18, true],
    [0.15, 0.26, false],
    [0.2, 0.19, false],
  ] as const) {
    for (const obstacleMargin of [0.01, 0.5]) {
      const node = structuredClone(raceNode)
      node.portPoints = node.portPoints.slice(0, 4)
      for (let i = 0; i < node.portPoints.length; i++) {
        node.portPoints[i]!.y = Math.floor(i / 2) * gap
      }
      const params = {
        nodeWithPortPoints: node,
        traceWidth,
        obstacleMargin,
        rejectOverlappingTerminals: true,
      }
      const portfolio = new PortfolioSingleIntraNodeSolver(params)
      const native = portfolio.generateSolver({ HIGH_DENSITY_A03: true })
      expect(native).toBeInstanceOf(HighDensitySolverA03)
      expect((native as unknown as HighDensitySolverA03).traceMargin).toBe(0.1)
      expect((native as unknown as HighDensitySolverA03).traceThickness).toBe(
        0.1,
      )
      expect(PortfolioSingleIntraNodeSolver.shouldRaceScales(params)).toBe(
        expected,
      )
    }
  }
})
