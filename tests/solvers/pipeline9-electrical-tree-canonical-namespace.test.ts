import { Pipeline9RegionalFallbackSolver, isPipeline9ObstacleConnectedToRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { HighDensitySolverA13WithDrcValidation } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13WithDrcValidation"
import { isPipeline9ObstacleOwnedByRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9ObstacleOwnedByRoute"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver, normalizePipeline9NodeRootConnectionNames } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getCanonicalPipeline9PortRoot } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getCanonicalPipeline9PortRoot"
import { arePipeline9RoutesOnSameNet } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { getObstacleRouteConnectivity } from "lib/solvers/HyperHighDensitySolver/getObstacleRouteConnectivity"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("canonical electrical keys cannot act as foreign aliases at native routing and obstacle boundaries", (): void => {
  const connMap = new ConnectivityMap({ connectivity_net0: ["left-net", "own-pad"], connectivity_net1: ["connectivity_net0", "right-net", "foreign-pad"] })
  const node: NodeWithPortPoints = { capacityMeshNodeId: "canonical-namespace", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1], portPoints: [
    { connectionName: "left-net", rootConnectionName: "connectivity_net0", portPointId: "left-a", x: 0, y: 0, z: 0 },
    { connectionName: "left-net", rootConnectionName: "connectivity_net0", portPointId: "left-b", x: 1, y: 0, z: 0 },
    { connectionName: "right-net", rootConnectionName: "connectivity_net1", portPointId: "right-a", x: 0.01, y: 0, z: 0 },
    { connectionName: "right-net", rootConnectionName: "connectivity_net1", portPointId: "right-b", x: -1, y: 0, z: 0 },
  ] }
  const normalized = normalizePipeline9NodeRootConnectionNames(node, connMap)
  expect(normalized.portPoints.map((point) => point.rootConnectionName)).toEqual(["connectivity_net0", "connectivity_net0", "connectivity_net1", "connectivity_net1"])
  const native = new PortfolioSingleIntraNodeSolver({ connMap, traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.15, rejectOverlappingTerminals: true, nodeWithPortPoints: normalized })
  expect(native.failed).toBe(true)
  expect(native.error).toContain("Unrelated route terminals overlap")
  const left: HighDensityRoute = { connectionName: "left-net", rootConnectionName: "connectivity_net0", traceThickness: 0.15, viaDiameter: 0.3, route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [] }
  const right = { ...left, connectionName: "right-net", rootConnectionName: "connectivity_net1" }
  expect(arePipeline9RoutesOnSameNet(left, right, connMap)).toBe(false)
  expect(arePipeline9RoutesOnSameNet(left, { ...left, connectionName: "unregistered-physical-branch" }, connMap)).toBe(true)
  expect(() => getCanonicalPipeline9PortRoot({ ...left, rootConnectionName: "right-net" }, connMap)).toThrow("foreign electrical root")
  expect(() => getCanonicalPipeline9PortRoot({ ...left, rootConnectionName: "connectivity_net1" }, connMap)).toThrow("foreign electrical root")
  expect(getCanonicalPipeline9PortRoot({ ...left, rootConnectionName: "unregistered-preload-annotation" }, connMap)).toBe("connectivity_net0")
  const isObstacleOwnedByRoute = (obstacle: Obstacle, route: Pick<HighDensityRoute, "connectionName" | "rootConnectionName">): boolean => isPipeline9ObstacleOwnedByRoute(obstacle, route, connMap)
  const foreign: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["right-net", "foreign-pad", "connectivity_net0"] }
  expect(getObstacleRouteConnectivity({ obstacles: [foreign], routes: [left], connMap, isObstacleOwnedByRoute }).connectedRouteNamesByObstacle).toEqual([[]])
  expect(getObstacleRouteConnectivity({ obstacles: [{ ...foreign, connectedTo: ["own-pad", "left-net", "connectivity_net0"] }], routes: [left], connMap, isObstacleOwnedByRoute }).connectedRouteNamesByObstacle).toEqual([["left-net"]])
  expect(isPipeline9ObstacleConnectedToRoute({ obstacle: foreign, route: left, connMap })).toBe(false)
  expect(isPipeline9ObstacleConnectedToRoute({ obstacle: { ...foreign, connectedTo: ["connectivity_net0"] }, route: left, connMap })).toBe(false)
  expect(isPipeline9ObstacleConnectedToRoute({ obstacle: { ...foreign, connectedTo: ["own-pad"] }, route: left, connMap })).toBe(true)
  const regional = new Pipeline9RegionalFallbackSolver({ nodeWithPortPoints: { ...node, portPoints: normalized.portPoints.slice(0, 2) }, connMap, colorMap: {}, viaDiameter: 0.3, traceWidth: 0.15,
    obstacleMargin: 0.15, effort: 1, nodePfById: {}, obstacles: [foreign], layerCount: 2 })
  expect(regional.highDensitySolver.isObstacleOwnedByRoute?.(foreign, left)).toBe(false)
  const regular = createPipeline9RegularNodeSolver({ nodeWithPortPoints: { ...node, portPoints: node.portPoints.slice(0, 2) }, connMap, colorMap: {}, viaDiameter: 0.3, traceWidth: 0.15,
    obstacleMargin: 0.15, effort: 1, nodePfById: {}, obstacles: [foreign], layerCount: 2 })
  expect(regular.isObstacleOwnedByRoute?.(foreign, left)).toBe(false)
  regular.step()
  const grow = regular.activeSubSolver
  if (!(grow instanceof GrowShrinkHighDensityIntraNodeSolver)) throw new Error("Expected the unchanged Pipeline9 native grow/shrink adapter")
  const portfolio = new PortfolioSingleIntraNodeSolver(grow.getConstructorParams())
  const physicalCandidate = portfolio.generateSolver({ HIGH_DENSITY_A13: true })
  if (!(physicalCandidate instanceof HighDensitySolverA13WithDrcValidation)) throw new Error("Expected the native A13 physical acceptance guard")
  expect(physicalCandidate.validationParams.isObstacleOwnedByRoute).toBe(regular.isObstacleOwnedByRoute)
  expect(physicalCandidate.validationParams.isObstacleOwnedByRoute?.(foreign, left)).toBe(false)
  // Legacy callers without a connectivity map still use explicit ID ownership.
  expect(getObstacleRouteConnectivity({ obstacles: [{ ...foreign, connectedTo: ["left-net"] }], routes: [left] }).connectedRouteNamesByObstacle).toEqual([["left-net"]])
})
