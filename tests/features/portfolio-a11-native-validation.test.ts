import { expect, test } from "bun:test"
import {
  HighDensitySolverA11,
  findRouteGeometryViolations,
} from "@tscircuit/high-density-a01"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import { HighDensitySolverA11WithDrcValidation } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA11WithDrcValidation"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { getNativeRouteValidationError } from "lib/solvers/HyperHighDensitySolver/getNativeRouteValidationError"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("A11 shares the native portfolio and rejects incomplete or invalid copper", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "native-pairs",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0],
    portPoints: [
      { connectionName: "signal", x: -2, y: 0, z: 0 },
      { connectionName: "signal", x: 2, y: 0, z: 0 },
    ],
  }
  const originalNode = structuredClone(node)
  const params = {
    nodeWithPortPoints: node,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacles: [],
    layerCount: 2,
    effort: 0.5,
  }
  const portfolio = new PortfolioSingleIntraNodeSolver({
    ...params,
    enableNegotiatedSearch: true,
  })
  portfolio.initializeSolvers()
  const candidate = portfolio.supervisedSolvers?.find(
    ({ solver }) => solver instanceof HighDensitySolverA11,
  )
  if (!candidate || !(candidate.solver instanceof HighDensitySolverA11WithDrcValidation)) {
    throw new Error("Native portfolio did not create the validated A11 candidate")
  }
  const a11 = candidate.solver
  const standalone = new HighDensitySolverA11(a11.validationParams)
  standalone.setup()
  expect(a11._setupDone).toBe(false)
  a11.step()
  expect(a11._setupDone).toBe(true)
  expect(a11.MAX_ITERATIONS).toBe(standalone.MAX_ITERATIONS)
  expect(a11.MAX_ITERATIONS).toBeGreaterThan(0)
  a11.solve()
  expect(a11.solved).toBe(true)
  expect(a11.failed).toBe(false)
  expect(a11.stats.boardDrcIssueCount).toBe(0)
  const routes = a11.getOutput()
  expect(routes).toHaveLength(1)
  expect(findRouteGeometryViolations(routes)).toEqual([])
  expect(getNativeRouteValidationError(routes, node)).toBeNull()
  portfolio.onSolve(candidate)
  expect(portfolio.solvedRoutes).toEqual(routes)
  expect(node).toEqual(originalNode)

  const aliasedNode: NodeWithPortPoints = {
    ...node,
    portPoints: [
      ...node.portPoints,
      ...node.portPoints.map((point) => ({
        ...point,
        connectionName: "alias",
        rootConnectionName: "signal",
      })),
    ],
  }
  expect(getNativeRouteValidationError(routes, aliasedNode)).toBeNull()
  const aliased = new HighDensitySolverA11WithDrcValidation({
    ...a11.validationParams,
    nodeWithPortPoints: aliasedNode,
  })
  aliased.solve()
  expect(aliased.solved).toBe(true)
  expect(aliased.getOutput()).toHaveLength(1)
  const distinctPairsInSameGridCells = new HighDensitySolverA11WithDrcValidation({
    ...a11.validationParams,
    nodeWithPortPoints: {
      ...aliasedNode,
      portPoints: aliasedNode.portPoints.map((point) => ({
        ...point,
        y: point.connectionName === "alias" ? 0.005 : point.y,
      })),
    },
  })
  distinctPairsInSameGridCells.solve()
  expect(distinctPairsInSameGridCells.solved).toBe(false)
  expect(distinctPairsInSameGridCells.error).toContain("omits physical port pairs")
  expect(getNativeRouteValidationError([], node)).toContain("omits")
  expect(getNativeRouteValidationError([...routes, ...routes], node)).toContain("duplicate")
  const movedEndpoint = structuredClone(routes)
  movedEndpoint[0]!.route[0]!.x += 1e-6
  expect(getNativeRouteValidationError(movedEndpoint, node)).toContain("inexact")
  const outside = structuredClone(routes)
  outside[0]!.route[1]!.y = 3
  expect(getNativeRouteValidationError(outside, node)).toContain("bounds")
  const nonFinite = structuredClone(routes)
  nonFinite[0]!.route[1]!.x = Number.NaN
  expect(getNativeRouteValidationError(nonFinite, node)).toContain("non-finite")
  const wrongLayer = structuredClone(routes)
  wrongLayer[0]!.route[1]!.z = 1
  expect(getNativeRouteValidationError(wrongLayer, node)).toContain("layer")

  const blocked = new HighDensitySolverA11WithDrcValidation({
    ...a11.validationParams,
    obstacles: [{
      type: "rect",
      center: { x: 0, y: 0 },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: ["other-net"],
      circuitJsonMetadata: {
        pcb_smtpad_id: "unrelated-pad",
        pcb_port_id: "unrelated-port",
      },
    }],
  })
  blocked.solve()
  expect(blocked.solved).toBe(false)
  expect(blocked.failed).toBe(true)
  expect(blocked.error).toContain("board copper validation")
  expect(blocked.stats.boardDrcIssueCount).toBeGreaterThan(0)

  const originalPortfolio = new PortfolioSingleIntraNodeSolver(params)
  originalPortfolio.initializeSolvers()
  expect(originalPortfolio.getCombinationDefs()).not.toContainEqual(["highDensityA11"])
  expect(portfolio.stats.dynamicExpansionWorkBudget).toBe(
    originalPortfolio.stats.dynamicExpansionWorkBudget,
  )
  for (const scaleFactor of [1, 2]) {
    const growth = new GrowShrinkHighDensityIntraNodeSolver(params)
    growth.scaleFactor = scaleFactor
    growth.step()
    const inner = growth.activeSubSolver ?? growth.winningSolver
    if (!inner) throw new Error("Grow/shrink did not construct its portfolio")
    expect(inner.getCombinationDefs().some((combination) =>
      combination.includes("highDensityA11"),
    )).toBe(scaleFactor === 1)
  }
})
