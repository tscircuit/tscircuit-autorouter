import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { normalizePipeline9NodeRootConnectionNames } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { assessComputeSelectionOutcome } from "lib/solvers/HyperHighDensitySolver/validateComputeSelectionOutcome"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("a registered canonical owner cannot turn a foreign pad into a physically clean learned outcome", (): void => {
  const connMap = new ConnectivityMap({
    connectivity_net0: ["left-net", "own-pad"],
    connectivity_net1: ["connectivity_net0", "right-net", "foreign-pad"],
  })
  const route: HighDensityRoute = {
    connectionName: "left-net", rootConnectionName: "connectivity_net0",
    traceThickness: 0.15, viaDiameter: 0.3, vias: [],
    route: [
      { x: -0.1, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
      { x: 0.1, y: 0, z: 1 },
    ],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "ownership", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1],
    portPoints: route.route.map(({ x, y, z }, index) => ({
      x, y, z, portPointId: String(index), connectionName: route.connectionName,
      rootConnectionName: route.rootConnectionName,
    })),
  }
  const obstacle: Obstacle = {
    type: "rect", center: { x: 0, y: 0 }, width: 1, height: 1,
    layers: ["top", "bottom"], connectedTo: ["right-net", "foreign-pad"],
  }
  const common = { routes: [route], node, connMap, layerCount: 2, traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.15 }
  expect(assessComputeSelectionOutcome({ ...common, obstacles: [obstacle] })).toEqual({ structurallyValid: false, physicallyClean: false })
  expect(assessComputeSelectionOutcome({ ...common, obstacles: [{ ...obstacle, connectedTo: ["connectivity_net0"] }] })).toEqual({ structurallyValid: false, physicallyClean: false })
  expect(assessComputeSelectionOutcome({ ...common, obstacles: [{ ...obstacle, connectedTo: ["left-net", "own-pad"] }] })).toEqual({ structurallyValid: true, physicallyClean: true })
  const normalized = normalizePipeline9NodeRootConnectionNames(node, connMap)
  expect(normalized.portPoints.map((port) => port.rootConnectionName)).toEqual(["connectivity_net0", "connectivity_net0"])
  expect(normalizePipeline9NodeRootConnectionNames(normalized, connMap)).toEqual(normalized)
  expect(() => normalizePipeline9NodeRootConnectionNames({ ...node, portPoints: node.portPoints.map((port) => ({ ...port, rootConnectionName: "right-net" })) }, connMap)).toThrow("foreign electrical root")
  expect(node.portPoints[0]!.rootConnectionName).toBe("connectivity_net0")
})
