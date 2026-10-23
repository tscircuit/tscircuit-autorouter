import { expect, test } from "bun:test"
import { validateComputeSelectionOutcome } from "lib/solvers/HyperHighDensitySolver/validateComputeSelectionOutcome"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"

test("learning labels require clearance and complete electrical connectivity at every requested port", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cell",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "a", x: -2, y: -0.5, z: 0 },
      { connectionName: "a", x: 2, y: -0.5, z: 0 },
      { connectionName: "b", x: -2, y: 0.5, z: 0 },
      { connectionName: "b", x: 2, y: 0.5, z: 0 },
    ],
  }
  const routes: HighDensityRoute[] = ["a", "b"].map((connectionName) => ({
    connectionName,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: node.portPoints.filter((port) => port.connectionName === connectionName)
      .map(({ x, y, z }) => ({ x, y, z })),
    vias: [],
  }))
  const params = {
    node,
    routes,
    obstacles: [],
    layerCount: 2,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
  }
  expect(validateComputeSelectionOutcome(params)).toBe(true)

  const crossing = structuredClone(routes)
  crossing[1]!.route.splice(1, 0, { x: 0, y: -1, z: 0 })
  expect(validateComputeSelectionOutcome({ ...params, routes: crossing })).toBe(false)
  const missingPort = structuredClone(routes)
  missingPort[0]!.route[1]!.x = 0
  expect(validateComputeSelectionOutcome({ ...params, routes: missingPort })).toBe(false)
  const disconnected = [
    { ...routes[0]!, route: [{ x: -2, y: -0.5, z: 0 }, { x: -1, y: -0.5, z: 0 }] },
    { ...routes[0]!, route: [{ x: 1, y: -0.5, z: 0 }, { x: 2, y: -0.5, z: 0 }] },
    routes[1]!,
  ]
  expect(validateComputeSelectionOutcome({ ...params, routes: disconnected })).toBe(false)
  expect(validateComputeSelectionOutcome({
    ...params,
    obstacles: [{
      type: "rect",
      center: { x: 0, y: -0.5 },
      width: 0.3,
      height: 0.3,
      ccwRotationDegrees: 45,
      layers: ["top"],
      connectedTo: [],
    }],
  })).toBe(false)
  const revisit = structuredClone(node)
  for (const port of revisit.portPoints) port.connectionName = "a"
  revisit.portPointsInPairs = [
    [revisit.portPoints[0]!, revisit.portPoints[1]!],
    [revisit.portPoints[2]!, revisit.portPoints[3]!],
  ]
  const revisitRoutes = routes.map((route) => ({ ...route, connectionName: "a" }))
  expect(validateComputeSelectionOutcome({
    ...params,
    node: revisit,
    routes: revisitRoutes,
  })).toBe(true)
  expect(validateComputeSelectionOutcome({
    ...params,
    node: { ...revisit, portPointsInPairs: undefined },
    routes: revisitRoutes,
  })).toBe(false)
  expect(validateComputeSelectionOutcome({
    ...params,
    node: revisit,
    routes: revisitRoutes.slice(0, 1),
  })).toBe(false)
  const malformedVia = structuredClone(routes)
  malformedVia[0]!.route[1]!.z = 1
  expect(validateComputeSelectionOutcome({ ...params, routes: malformedVia })).toBe(false)
  const bridgeNode: NodeWithPortPoints = {
    ...node,
    portPoints: [
      { connectionName: "a", x: -0.2, y: 0, z: 0 },
      { connectionName: "a", x: 0.2, y: 0, z: 1 },
    ],
  }
  const bridge: HighDensityRoute = {
    ...routes[0]!,
    route: [
      { x: -0.2, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
      { x: 0.2, y: 0, z: 1 },
    ],
  }
  expect(validateComputeSelectionOutcome({
    ...params,
    node: bridgeNode,
    routes: [bridge],
    obstacles: [{
      type: "rect",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      layers: ["top", "bottom"],
      connectedTo: ["a"],
    }],
  })).toBe(true)
  expect(validateComputeSelectionOutcome({ ...params, node: bridgeNode, routes: [bridge] })).toBe(false)
  const narrow = structuredClone(routes)
  narrow[0]!.traceThickness = 0.05
  expect(validateComputeSelectionOutcome({ ...params, routes: narrow })).toBe(false)
  const smallVia = structuredClone(routes)
  smallVia[0]!.viaDiameter = 0.2
  expect(validateComputeSelectionOutcome({ ...params, routes: smallVia })).toBe(false)
  const thick = structuredClone(routes)
  thick[0]!.traceThickness = 1
  expect(validateComputeSelectionOutcome({
    ...params,
    routes: thick,
    obstacles: [{
      type: "rect",
      center: { x: 0, y: -1.05 },
      width: 0.1,
      height: 0.1,
      layers: ["top"],
      connectedTo: [],
    }],
  })).toBe(false)
})
