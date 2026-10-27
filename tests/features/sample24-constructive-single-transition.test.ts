import { expect, test } from "bun:test"
import { SingleTransitionIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import fixture from "../fixtures/sample24-constructive-transition-c74.json"

test("the actual C74 transition constructs a legal external via before publishing its route", (): void => {
  const params = { nodeWithPortPoints: structuredClone(fixture.node), viaDiameter: 0.3, traceThickness: 0.1 }
  const context = { obstacles: structuredClone(fixture.obstacles), layerCount: 8, allowBlindAndBuriedVias: false,
    viaToPadClearance: 0.15, traceToPadClearance: 0.15, boardGeometry: fixture.boardGeometry, coordinateScale: 1 }
  const oldNominal = new SingleTransitionIntraNodeSolver(params)
  expect(oldNominal.solvedRoutes[0]!.vias).toEqual([fixture.capturedVia])
  const solver = new SingleTransitionIntraNodeSolver({ ...params, boardContext: context })
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const route = solver.solvedRoutes[0]!
  expect(route.connectionName).toBe(fixture.node.portPoints[0]!.connectionName)
  expect(route.vias).not.toEqual([fixture.capturedVia])
  expect(Math.abs(route.vias[0]!.x - fixture.node.center.x)).toBeGreaterThan(fixture.node.width / 2)
  expect(route.vias[0]!.y).toBeCloseTo(fixture.node.portPoints[0]!.y, 8)
  expect(route.traceThickness).toBe(0.1)
  expect(route.viaDiameter).toBe(0.3)
  expect(route.route[0]).toEqual({ x: params.nodeWithPortPoints.portPoints[0]!.x, y: params.nodeWithPortPoints.portPoints[0]!.y, z: 4 })
  expect(route.route.at(-1)).toEqual({ x: params.nodeWithPortPoints.portPoints[1]!.x, y: params.nodeWithPortPoints.portPoints[1]!.y, z: 0 })
  expect(params.nodeWithPortPoints.availableZ).toEqual([0, 1, 2, 3, 4, 5, 6])
  expect(new SingleTransitionIntraNodeSolver({ ...params, boardContext: { ...context, obstacles: [...context.obstacles].reverse() } }).solvedRoutes).toEqual(solver.solvedRoutes)

  // Retain the legacy affine-frame regression; physical WORLD growth is tested separately.
  const grow = new GrowShrinkHighDensityIntraNodeSolver({ nodeWithPortPoints: structuredClone(fixture.node),
    obstacles: context.obstacles, layerCount: 8, allowBlindAndBuriedVias: false, traceWidth: 0.1,
    viaDiameter: 0.3, obstacleMargin: 0.15, boardGeometry: fixture.boardGeometry })
  grow.physicalWorldBounds = false
  grow.scaleFactor = 8
  ;(grow as any).createActiveSubSolver()
  const portfolio = grow.activeSubSolver! as PortfolioSingleIntraNodeSolver
  const candidate = portfolio.generateSolver({ CLOSED_FORM_SINGLE_TRANSITION: true })
  expect(candidate.solved).toBe(true)
  portfolio.supervisedSolvers = [{ solver: candidate, hyperParameters: {}, f: 0, g: 0, h: 0 }]
  portfolio.step()
  expect(portfolio.solved).toBe(true)
  ;(grow as any).acceptSolution(portfolio)
  expect(grow.solved).toBe(true)
  expect(grow.solvedRoutes[0]!.vias[0]!.x).toBeCloseTo(route.vias[0]!.x, 8)
  expect(grow.solvedRoutes[0]!.vias[0]!.y).toBeCloseTo(route.vias[0]!.y, 8)
  expect(grow.solvedRoutes[0]!.viaDiameter).toBe(0.3)
  expect(grow.solvedRoutes[0]!.traceThickness).toBe(0.1)
  expect(params.nodeWithPortPoints).toEqual(fixture.node)
  expect(context.obstacles).toEqual(fixture.obstacles)
})
