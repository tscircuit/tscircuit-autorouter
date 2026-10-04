import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const makeSolver = (obstacleMargin = 0.15): Pipeline9HighDensitySolver => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 4, height: 4,
    availableZ: [0, 1],
    portPoints: [
      { x: -2, y: -1, z: 0, connectionName: "a", pcb_port_id: "a0" },
      { x: 2, y: 1, z: 0, connectionName: "a", pcb_port_id: "a1" },
    ],
  }
  return new Pipeline9HighDensitySolver({
    nodePortPoints: [node], fixedHdRoutes: [], connMap: new ConnectivityMap({}),
    obstacles: [], boardGeometry: { bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 } },
    layerCount: 2, viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin, effort: 1,
    minTraceToHoleEdgeClearance: 0.4, preserveTerminalPcbPortIds: false,
  })
}

test("only original native preload-free queries forward boundary certificate and prior copper", () => {
  const solver = makeSolver()
  solver.step()
  const regular = solver.activeRegularSolver!
  expect(regular.straightRoutePreflightContext?.minTraceToHoleEdgeClearance).toBe(0.4)
  regular.step()
  const grow = regular.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver
  grow.step()
  const portfolio = grow.winningSolver!
  expect(portfolio.stats.straightPreflightAccepted).toBe(true)
  expect(portfolio.solvedRoutes[0]!.route[0]!.pcb_port_id).toBeUndefined()
  expect(portfolio.solvedRoutes[0]!.route.at(-1)!.pcb_port_id).toBeUndefined()
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.routes[0]!.startPcbPortId).toBeUndefined()
  const smallMargin = makeSolver(0.1)
  smallMargin.step()
  expect(smallMargin.activeRegularSolver!.straightRoutePreflightContext).toBeUndefined()
  const previousNode = makeSolver()
  previousNode.routes.push({ connectionName: "other", traceThickness: 0.15, viaDiameter: 0.3, route: [{ x: 0, y: -3, z: 0 }, { x: 0, y: 3, z: 0 }], vias: [] })
  previousNode.step()
  const previousRegular = previousNode.activeRegularSolver!
  expect(previousRegular.straightRoutePreflightContext!.surroundingRoutes).toHaveLength(1)
  previousRegular.step()
  const previousGrow = previousRegular.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver
  previousGrow.step()
  const previousPortfolio = previousGrow.activeSubSolver ?? previousGrow.winningSolver!
  expect(previousPortfolio.stats.straightPreflightAccepted).toBeUndefined()
  expect(previousPortfolio.supervisedSolvers).toBeDefined()
  const resized = makeSolver()
  resized.step()
  resized.activeRegularSolver!.step()
  const resizedGrow = resized.activeRegularSolver!.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver
  resizedGrow.growthAttempts = 1
  resizedGrow.scaleFactor = 2
  resizedGrow.step()
  expect((resizedGrow.activeSubSolver ?? resizedGrow.winningSolver)!.constructorParams.straightRoutePreflightContext).toBeUndefined()
  const originalLayerChange = makeSolver()
  originalLayerChange.fixedHdRoutes.push({ preloadedTraceIndex: 0, preloadedRouteIndex: 0, connectionName: "prior", traceThickness: 0.15, viaDiameter: 0.3, route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }], vias: [{ x: 0, y: 0 }] })
  originalLayerChange.step()
  expect(originalLayerChange.activeRegularSolver).toBeNull()
  expect(originalLayerChange.activeB01Solver).not.toBeNull()
})
