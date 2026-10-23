import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { findRouteGeometryViolations } from "@tscircuit/high-density-a13"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("the default Pipeline9 node path avoids losing native grids without changing physical route metadata", (): void => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "default-native-defer", center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1], portPoints: [
    { connectionName: "wireA", rootConnectionName: "netA", pcb_port_id: "a0", x: -1, y: -0.5, z: 0 },
    { connectionName: "wireA", rootConnectionName: "netA", pcb_port_id: "a1", x: 1, y: -0.5, z: 0 },
    { connectionName: "wireB", rootConnectionName: "netB", pcb_port_id: "b0", x: -1, y: 0.5, z: 0 },
    { connectionName: "wireB", rootConnectionName: "netB", pcb_port_id: "b1", x: 1, y: 0.5, z: 0 },
  ] }
  const solver = createPipeline9RegularNodeSolver({ nodeWithPortPoints: node, connMap: new ConnectivityMap({ netA: ["wireA"], netB: ["wireB"] }), colorMap: {}, viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15, effort: 1, nodePfById: new Map(), obstacles: [], layerCount: 2 })
  const portfolios = new Set<PortfolioSingleIntraNodeSolver>()
  const wrappers = new Set<GrowShrinkHighDensityIntraNodeSolver>()
  while (!solver.solved && !solver.failed) {
    solver.step()
    const active = solver.activeSubSolver
    if (active instanceof GrowShrinkHighDensityIntraNodeSolver) wrappers.add(active)
    const portfolio = active instanceof GrowShrinkHighDensityIntraNodeSolver ? active.activeSubSolver ?? active.winningSolver : active
    if (portfolio instanceof PortfolioSingleIntraNodeSolver) portfolios.add(portfolio)
  }
  for (const wrapper of wrappers) {
    if (wrapper.winningSolver) portfolios.add(wrapper.winningSolver)
  }
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.routes).toHaveLength(2)
  expect(findRouteGeometryViolations(solver.routes)).toEqual([])
  expect([...portfolios].reduce((sum, portfolio) => sum + portfolio.nativeGridSetupDiagnostics.deferredCandidateCount, 0)).toBeGreaterThan(0)
  expect([...portfolios].reduce((sum, portfolio) => sum + portfolio.nativeGridSetupDiagnostics.materializedCandidateCount, 0)).toBe(0)
  for (const route of solver.routes) {
    expect(route.traceThickness).toBe(0.15)
    expect(route.viaDiameter).toBe(0.3)
    expect(route.regionId).toBe(node.capacityMeshNodeId)
    expect(route.rootConnectionName).toBe(route.connectionName === "wireA" ? "netA" : "netB")
    const pair = node.portPoints.filter((point) => point.connectionName === route.connectionName)
    expect(route.route[0]).toMatchObject({ x: pair[0]!.x, y: pair[0]!.y, z: pair[0]!.z })
    expect(route.route.at(-1)).toMatchObject({ x: pair[1]!.x, y: pair[1]!.y, z: pair[1]!.z })
  }
})
