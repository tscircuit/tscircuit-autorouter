import { expect, test } from "bun:test"
import { PathPackingIntraNodeSolver } from "lib/solvers/HighDensitySolver/PathPackingIntraNodeSolver"
import { precomputeIntraNodeRouteParams } from "lib/solvers/HighDensitySolver/precomputeIntraNodeRouteParams"
import { createPathPackingAudit } from "lib/solvers/HighDensitySolver/pathPackingGeometry"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { packingCrossingNode } from "./fixtures/pathPackingSynthetic"

test("packing preflight uses native canonical terminals and rejects oversized domains before examining ports", () => {
  const node = structuredClone(packingCrossingNode)
  node.portPoints[1] = { ...node.portPoints[0]!, x: node.portPoints[0]!.x + 1e-7 }
  const native = precomputeIntraNodeRouteParams(node)
  expect([...native.connectionPointsByName.values()].map((p) => p.length)).toEqual([1, 2])
  const stats = createPathPackingAudit()
  const params = { nodeWithPortPoints: node, traceWidth: 0.1, viaDiameter: 0.3,
    pathPackingStats: stats, experimentPathPacking: true }
  expect(PathPackingIntraNodeSolver.isApplicable(params)).toBeFalse()
  const portfolio = new PortfolioSingleIntraNodeSolver(params)
  expect(portfolio.getHyperParameterDefs().some((p) => p.name === "pathPacking")).toBeFalse()
  expect(portfolio.getCombinationDefs().flat()).not.toContain("pathPacking")
  expect(stats.instances).toBe(0)
  let examined = 0
  const oversized = { ...node, portPoints: new Proxy(new Array(10_000), {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) { examined++; throw new Error("Examined ineligible port") }
      return Reflect.get(target, key, receiver)
    },
  }) }
  expect(PathPackingIntraNodeSolver.hasSmallDomain(oversized)).toBeFalse()
  expect(PathPackingIntraNodeSolver.isApplicable({ ...params, nodeWithPortPoints: oversized })).toBeFalse()
  expect(examined).toBe(0)
  const manyNames = { ...node, portPoints: Array.from({ length: 14 }, (_, i) => ({
    connectionName: `net${Math.floor(i / 2)}`, x: i, y: 0, z: 0,
  })) }
  expect(PathPackingIntraNodeSolver.hasSmallDomain(manyNames)).toBeFalse()
})
