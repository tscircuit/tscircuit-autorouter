import { getFixedObstacleViolationsWithOwnership } from "lib/solvers/HyperHighDensitySolver/getFixedObstacleViolationsWithOwnership"
import { isPipeline9ObstacleOwnedByRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9ObstacleOwnedByRoute"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9HighDensityBatchSolver, type Pipeline9HighDensityBatchInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { HighDensitySolverA13WithDrcValidation } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13WithDrcValidation"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"

test("canonical physical ownership is reconstructed in workers and never confused with cached kernel acceptance", async (): Promise<void> => {
  const connMap = new ConnectivityMap({ connectivity_net0: ["left-net", "own-pad"], connectivity_net1: ["connectivity_net0", "right-net", "foreign-pad"] })
  const node: NodeWithPortPoints = { capacityMeshNodeId: "runtime-owner", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1], portPoints: [
    { connectionName: "left-net", rootConnectionName: "connectivity_net0", portPointId: "a", x: 0, y: 0, z: 0 },
    { connectionName: "left-net", rootConnectionName: "connectivity_net0", portPointId: "b", x: 1, y: 0, z: 0 },
  ] }
  const foreign: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["foreign-pad", "right-net", "connectivity_net0"], circuitJsonMetadata: { pcb_smtpad_id: "foreign-smd", pcb_port_id: "foreign-pad" } }
  const regular = createPipeline9RegularNodeSolver({ nodeWithPortPoints: node, connMap, colorMap: {}, viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15, effort: 1, nodePfById: {}, obstacles: [foreign], layerCount: 2 })
  const ownership = regular.isObstacleOwnedByRoute!
  let ownershipCalls = 0
  regular.isObstacleOwnedByRoute = (obstacle, route): boolean => { ownershipCalls++; return ownership(obstacle, route) }
  regular.step()
  const grow = regular.activeSubSolver
  if (!(grow instanceof GrowShrinkHighDensityIntraNodeSolver)) throw new Error("Expected native grow/shrink")
  const cacheProvider = new InMemoryCache()
  const common = { ...grow.getConstructorParams(), cacheProvider }
  const legacy = new PortfolioSingleIntraNodeSolver({ ...common, isObstacleOwnedByRoute: undefined }).generateSolver({})
  const strictPortfolio = new PortfolioSingleIntraNodeSolver(common)
  const kernel = strictPortfolio.generateSolver({})
  if (!(legacy instanceof CachedIntraNodeRouteSolver) || !(kernel instanceof CachedIntraNodeRouteSolver)) throw new Error("Expected the unchanged cacheable routing kernel")
  expect(kernel.computeCacheKeyAndTransform().cacheKey).toBe(legacy.computeCacheKeyAndTransform().cacheKey)
  legacy.solve()
  expect(kernel.attemptToUseCacheSync()).toBe(true)
  expect(kernel.solvedRoutes).toEqual(legacy.solvedRoutes)
  expect(ownershipCalls).toBe(0)
  const keysBeforePhysicalAcceptance = cacheProvider.getAllCacheKeys()
  const physical = strictPortfolio.generateSolver({ HIGH_DENSITY_A13: true })
  if (!(physical instanceof HighDensitySolverA13WithDrcValidation)) throw new Error("Expected the uncached native physical guard")
  physical.solve()
  expect(ownershipCalls).toBeGreaterThan(0)
  expect(physical.failed).toBe(true)
  expect(physical.error).toContain("board copper validation")
  expect(cacheProvider.getAllCacheKeys()).toEqual(keysBeforePhysicalAcceptance)
  const nearPad: Obstacle = { ...foreign, center: { x: 0.5, y: 0.295 }, connectedTo: ["right-net", "pcb_port_foreign"], circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_foreign", pcb_port_id: "pcb_port_foreign" } }
  const nearForeign = new HighDensitySolverA13WithDrcValidation({ ...physical.validationParams, traceMargin: 0.15, obstacles: [nearPad] })
  nearForeign.solve()
  expect(nearForeign.getOutput().flatMap((route) => route.route).every((point) => point.y === 0)).toBe(true)
  expect(nearForeign.failed).toBe(true)
  expect(nearForeign.stats.boardDrcIssueCount).toBeGreaterThan(0)
  const nearOwn = new HighDensitySolverA13WithDrcValidation({ ...physical.validationParams, traceMargin: 0.15, obstacles: [{ ...nearPad, connectedTo: ["left-net", "own-pad", "pcb_port_own"], circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_own", pcb_port_id: "pcb_port_own" } }] })
  nearOwn.solve()
  expect(nearOwn.solved).toBe(true)
  expect(nearOwn.failed).toBe(false)
  const left = { connectionName: "left-net", rootConnectionName: "connectivity_net0", traceThickness: 0.15, viaDiameter: 0.3, vias: [], route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] }
  const right = { ...left, connectionName: "right-net", rootConnectionName: "connectivity_net1", route: [{ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }] }
  const pairObstacles: Obstacle[] = [
    { ...foreign, center: { x: 0.5, y: 0.45 }, width: 0.1, height: 0.1, connectedTo: ["left-net", "connectivity_net0"] },
    { ...foreign, center: { x: 0.5, y: 0 }, width: 0.1, height: 0.1, connectedTo: ["right-net", "foreign-pad"] },
  ]
  const pairRoutes = [left, right]
  const fixed = getFixedObstacleViolationsWithOwnership({ srj: { layerCount: 2, minTraceWidth: 0.15, bounds: { minX: -1, maxX: 2, minY: -1, maxY: 2 }, obstacles: pairObstacles, connections: [] }, routes: pairRoutes,
    isObstacleOwnedByRouteIndex: (routeIndex, obstacleIndex): boolean => isPipeline9ObstacleOwnedByRoute(pairObstacles[obstacleIndex]!, pairRoutes[routeIndex]!, connMap) })
  expect(fixed).toHaveLength(1)
  expect(fixed[0]!.routeIndex).toBe(0)
  expect(fixed[0]!.obstacleIndex).toBe(1)
  const input: Pipeline9HighDensityBatchInput = { nodePortPoints: [{ ...node, portPoints: [
    { ...node.portPoints[0]!, x: -1, y: -1 }, { ...node.portPoints[1]!, x: 1, y: -1 },
    { connectionName: "right-net", rootConnectionName: "connectivity_net1", portPointId: "c", x: -1, y: 1, z: 0 },
    { connectionName: "right-net", rootConnectionName: "connectivity_net1", portPointId: "d", x: 1, y: 1, z: 0 },
  ] }], fixedHdRoutes: [], connectivityNetMap: connMap.netMap, obstacles: [], layerCount: 2, viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15, effort: 1, nodePfById: {}, maxIterations: 1000000 }
  const serialized = JSON.stringify(input)
  expect(serialized).not.toContain("isObstacleOwnedByRoute")
  const serial = new Pipeline9HighDensityBatchSolver(JSON.parse(serialized))
  serial.solve()
  expect(serial.getOutput().solved).toBe(true)
  const runtime = createPipeline9TestRuntime(1)
  try {
    const remote = await runtime.executeAsync(Pipeline9HighDensityBatchSolver, JSON.parse(serialized))
    expect(remote).toEqual(serial.getOutput())
    expect(remote.routes.map((route) => route.rootConnectionName).sort()).toEqual(["connectivity_net0", "connectivity_net1"])
  } finally { await runtime.dispose() }
})
