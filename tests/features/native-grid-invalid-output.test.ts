import { expect, spyOn, test } from "bun:test"
import { HighDensitySolverA11 } from "@tscircuit/high-density-a01"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("a native candidate cannot silently continue after returning invalid solved output", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    portPoints: [
      { connectionName: "net", rootConnectionName: "root", x: -1, y: 0, z: 0 },
      { connectionName: "net", rootConnectionName: "root", x: 1, y: 0, z: 0 },
    ],
  }
  const solver = new HighDensitySolverA11({ nodeWithPortPoints, viaDiameter: 0.3 })
  solver.solve()
  expect(solver.solved).toBe(true)
  const validRoutes = solver.getOutput()
  const outputSpy = spyOn(solver, "getOutput").mockReturnValue([])
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints,
  })

  expect(() =>
    portfolio.onSolve({ solver, hyperParameters: {}, h: 0, g: 0, f: 0 }),
  ).toThrow("physical port-point pairs are not covered exactly once")
  expect(portfolio.solvedRoutes).toEqual([])
  outputSpy.mockReturnValue(
    validRoutes.map((route) => ({ ...route, rootConnectionName: "wrong-root" })),
  )
  expect(() =>
    portfolio.onSolve({ solver, hyperParameters: {}, h: 0, g: 0, f: 0 }),
  ).toThrow("physical port-point pairs are not covered exactly once")
  expect(portfolio.solvedRoutes).toEqual([])
  for (const invalidPoint of [
    { x: Number.NaN, y: 0, z: 0 },
    { x: 0, y: 2, z: 0 },
    { x: 0, y: 0, z: 0.5 },
    { x: 0, y: 0, z: 10 },
  ]) {
    const invalidRoutes = structuredClone(validRoutes)
    invalidRoutes[0]!.route.splice(1, 0, invalidPoint)
    outputSpy.mockReturnValue(invalidRoutes)
    expect(() =>
      portfolio.onSolve({ solver, hyperParameters: {}, h: 0, g: 0, f: 0 }),
    ).toThrow("non-finite, out-of-bounds, or unavailable-layer route point")
    expect(portfolio.solvedRoutes).toEqual([])
  }
  outputSpy.mockRestore()
})
