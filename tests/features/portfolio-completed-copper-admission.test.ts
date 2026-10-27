import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { SingleTransitionIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import { SingleLayerNoDifferentRootIntersectionsIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"
import { CompletedCopperWorldIndex, areRoutesClearOfCompletedCopper } from "lib/solvers/HighDensitySolver/completedCopperWorldIndex"
import type { NodeWithPortPoints, HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("portfolio rejects completed-peer and shrink-induced internal copper conflicts before publishing and can accept the next real candidate", () => {
  const index = new CompletedCopperWorldIndex({ layerCount: 8, traceClearance: .1, viaHoleDiameter: .15 })
  const prior: HighDensityIntraNodeRoute = { connectionName: "prior", regionId: "earlier-cell", traceThickness: .1,
    viaDiameter: .3, vias: [], route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] }
  index.addRoutes([prior])
  const node: NodeWithPortPoints = { capacityMeshNodeId: "later-cell", center: { x: 0, y: 0 }, width: 4, height: 4,
    availableZ: [0, 1], portPoints: [{ connectionName: "future", x: 0, y: -1, z: 0 }, { connectionName: "future", x: 0, y: 1, z: 1 }] }
  const boardContext = { obstacles: [], layerCount: 8, allowBlindAndBuriedVias: false, viaToPadClearance: .1,
    traceToPadClearance: .1, traceToHoleClearance: .2, coordinateScale: 1,
    boardGeometry: { bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 } } }
  const bad = new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: node, traceThickness: .1, viaDiameter: .3, boardContext })
  expect(bad.solved).toBe(true)
  expect(bad.solvedRoutes[0]!.vias).toEqual([{ x: 0, y: 0 }])
  const portfolio = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints: node, layerCount: 8,
    obstacles: [], traceWidth: .1, viaDiameter: .3, routedPeerWorldIndex: index })
  const supervise = (solver: unknown): Parameters<typeof portfolio.onSolve>[0] => ({ solver } as Parameters<typeof portfolio.onSolve>[0])
  portfolio.onSolve(supervise(bad))
  expect(portfolio.solvedRoutes).toEqual([])
  expect(portfolio.failed).toBe(false)
  expect(bad.failed).toBe(true)
  expect(portfolio.stats.rejectedCompletedCopperCandidateCount).toBe(1)
  const good = new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: node, traceThickness: .1, viaDiameter: .3,
    boardContext: { ...boardContext, routedPeerRoutes: [prior] } })
  expect(good.solved).toBe(true)
  expect(areRoutesClearOfCompletedCopper({ routes: good.solvedRoutes, routedPeerWorldIndex: index })).toBe(true)
  portfolio.onSolve(supervise(good))
  expect(portfolio.solvedRoutes).toEqual(good.solvedRoutes)
  expect(good.failed).toBe(false)

  const planar: NodeWithPortPoints = { capacityMeshNodeId: "scaled-planar", center: { x: 0, y: 0 }, width: 4, height: 4,
    availableZ: [0], portPoints: [
      { connectionName: "a", x: -1, y: 0, z: 0 }, { connectionName: "a", x: 1, y: 0, z: 0 },
      { connectionName: "b", x: -1, y: .3, z: 0 }, { connectionName: "b", x: 1, y: .3, z: 0 },
    ] }
  const direct = (): SingleLayerNoDifferentRootIntersectionsIntraNodeSolver => {
    const solver = new SingleLayerNoDifferentRootIntersectionsIntraNodeSolver({ nodeWithPortPoints: planar, traceWidth: .1, viaDiameter: .3 })
    solver.solve()
    return solver
  }
  const empty = new CompletedCopperWorldIndex({ layerCount: 8, traceClearance: .1 })
  const scaled = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints: planar, layerCount: 8, traceWidth: .1,
    viaDiameter: .3, priorityCoordinateScale: 2, routedPeerWorldIndex: empty })
  const atScale = direct()
  expect(atScale.solved).toBe(true)
  expect(areRoutesClearOfCompletedCopper({ routes: atScale.solvedRoutes, routedPeerWorldIndex: empty })).toBe(true)
  scaled.onSolve(supervise(atScale))
  expect(scaled.solvedRoutes).toEqual([])
  expect(atScale.failed).toBe(true)
  const world = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints: planar, layerCount: 8, traceWidth: .1,
    viaDiameter: .3, priorityCoordinateScale: 1, routedPeerWorldIndex: empty })
  const unscaled = direct()
  world.onSolve(supervise(unscaled))
  expect(world.solvedRoutes).toEqual(unscaled.solvedRoutes)
})
