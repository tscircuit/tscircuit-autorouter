import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { constructPipeline9ParametricCell } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9ParametricCell"
import { isPipeline9ObstacleOwnedByRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9ObstacleOwnedByRoute"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("a canonical route key cannot alias away a foreign physical pad during strict domain certification", (): void => {
  const connMap = new ConnectivityMap({ connectivity_net0: ["left-net", "own-pad"], connectivity_net1: ["connectivity_net0", "right-net", "foreign-pad"] })
  const node: NodeWithPortPoints = { capacityMeshNodeId: "namespace", center: { x: 0, y: 0 }, width: 4, height: 4, portPoints: [
    { portPointId: "a", connectionName: "left-net", rootConnectionName: "connectivity_net0", x: -1, y: 0, z: 0 },
    { portPointId: "b", connectionName: "left-net", rootConnectionName: "connectivity_net0", x: 1, y: 0, z: 0 },
  ] }
  const foreign: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["foreign-pad", "right-net", "connectivity_net0"] }
  const routeOwner = { connectionName: "left-net", rootConnectionName: "connectivity_net0" }
  expect(isPipeline9ObstacleOwnedByRoute(foreign, routeOwner, connMap)).toBe(false)
  expect(isPipeline9ObstacleOwnedByRoute({ ...foreign, connectedTo: ["connectivity_net0"] }, routeOwner, connMap)).toBe(false)
  expect(isPipeline9ObstacleOwnedByRoute({ ...foreign, connectedTo: ["own-pad", "left-net", "connectivity_net0"] }, routeOwner, connMap)).toBe(true)
  const common = { node, connMap, layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.15 }
  // Retain the exact historical local-domain API as a versioned oracle. The
  // production strict policy must not accept its canonical-as-alias shortcut.
  expect(constructPipeline9ParametricCell({ ...common, obstacles: [foreign] }).applicable).toBe(true)
  const interfacePortPoints = node.portPoints.map((port) => ({ capacityMeshNodeId: node.capacityMeshNodeId, port, traceWidth: common.traceWidth }))
  const strict = constructPipeline9ParametricCell({ ...common, obstacles: [foreign], interfacePolicy: "owned-normal-escapes", interfacePortPoints })
  expect(strict.applicable).toBe(false)
  expect(strict.routes).toEqual([])
  expect(strict.stats.parametricObstacleDistanceChecks).toBeGreaterThan(0)
  const own = constructPipeline9ParametricCell({ ...common, obstacles: [{ ...foreign, connectedTo: ["own-pad", "left-net", "connectivity_net0"] }], interfacePolicy: "owned-normal-escapes", interfacePortPoints })
  expect(own.applicable).toBe(true)
})
