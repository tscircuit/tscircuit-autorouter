import { test, expect } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { Pipeline9InteractionGroupedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InteractionGroupedHighDensitySolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

test("adding a grouping candidate preserves native candidates and their adaptive expansion allowance", () => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "obstacle", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0, 1], portPoints: [{ connectionName: "a", x: -2, y: 0, z: 0 }, { connectionName: "a", x: 2, y: 0, z: 0 }] }
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 0.5, height: 0.5, layers: ["top"], connectedTo: ["foreign"] }], connections: [{ name: "a", pointsToConnect: [{ x: -2, y: 0, layer: "top" }, { x: 2, y: 0, layer: "top" }] }] }
  const params = { nodeWithPortPoints: node, connMap: getConnectivityMapFromSimpleRouteJson(srj), viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.1, effort: 1, obstacles: srj.obstacles, layerCount: 2, enableNegotiatedSearch: true, gridSearchSegmentWork: 500 }
  const ordinary = new PortfolioSingleIntraNodeSolver(params)
  const experimental = new PortfolioSingleIntraNodeSolver({ ...params, enableInteractionGrouping: true })
  ordinary.initializeSolvers(); experimental.initializeSolvers()
  const native = experimental.supervisedSolvers!.filter(({ solver }) => !(solver instanceof Pipeline9InteractionGroupedHighDensitySolver))
  expect(native.map(s => s.hyperParameters)).toEqual(ordinary.supervisedSolvers!.map(s => s.hyperParameters))
  expect(native.map(s => s.solver.MAX_ITERATIONS)).toEqual(ordinary.supervisedSolvers!.map(s => s.solver.MAX_ITERATIONS))
  expect(experimental.stats.dynamicExpansionWorkBudget).toBe(ordinary.stats.dynamicExpansionWorkBudget)
  const grouping = experimental.supervisedSolvers!.find(({ solver }) => solver instanceof Pipeline9InteractionGroupedHighDensitySolver)!.solver
  grouping.solve()
  expect(grouping.failed).toBe(true)
  experimental.solve(); ordinary.solve()
  expect(experimental.solved).toBe(ordinary.solved)
  expect(experimental.failed).toBe(false)
  expect(experimental.winningSolver).not.toBe(grouping)
  expect(experimental.solvedRoutes).toEqual(ordinary.solvedRoutes)
})
