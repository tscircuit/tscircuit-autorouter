import { expect, test } from "bun:test"
import { findRouteGeometryViolations } from "@tscircuit/high-density-a13"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import nodeJson from "../fixtures/a13-srj18-hard-node.json"

const node: NodeWithPortPoints = nodeJson

test("the high-density portfolio routes the SRJ18 hard node with A13 at 1x", () => {
  const original = structuredClone(node)
  const solver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: node,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 2,
    effort: 1,
    enableNegotiatedSearch: true,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.negotiatedSearchStarted).toBe(true)
  expect(
    solver.supervisedSolvers!
      .filter(({ solver: candidate }) => candidate !== solver.winningSolver)
      .every(({ solver: candidate }) => candidate.failed),
  ).toBe(true)
  expect(solver.winningSolver?.getSolverName()).toBe("HighDensitySolverA13")
  expect(solver.solvedRoutes).toHaveLength(26)
  expect(
    findRouteGeometryViolations(
      solver.solvedRoutes.map((route) => ({
        ...route,
        traceThickness: route.traceThickness + 0.1,
        viaDiameter: route.viaDiameter + 0.1,
      })),
    ),
  ).toEqual([])
  for (const route of solver.solvedRoutes) {
    expect(route.traceThickness).toBe(0.1)
    expect(route.viaDiameter).toBe(0.3)
    expect(route.rootConnectionName).toBe(
      node.portPoints.find(
        (point) => point.connectionName === route.connectionName,
      )!.rootConnectionName,
    )
  }
  expect(node).toEqual(original)
})
