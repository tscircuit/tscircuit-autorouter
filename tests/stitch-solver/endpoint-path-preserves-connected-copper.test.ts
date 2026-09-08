import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import {
  EndpointClusterIndex,
  findRoutesAlongEndpointPath,
  selectRoutesAlongEndpointPath,
} from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("endpoint paths retain connected copper instead of taking gap shortcuts", (): void => {
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 2, z: 0 },
    { x: 2.5, y: 2, z: 0 },
    { x: 2.5, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
  ]
  const hdRoutes: HighDensityIntraNodeRoute[] = points
    .slice(1)
    .map((end, index) => ({
      connectionName: "connected_copper",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [points[index]!, end],
      vias: [],
    }))

  const selectedRoutes = selectRoutesAlongEndpointPath({
    connectionName: "connected_copper",
    hdRoutes,
    start: points[0]!,
    end: points[points.length - 1]!,
    endpointIndex: new EndpointClusterIndex(),
    canStitchBetweenTerminals: () => true,
  })

  expect(selectedRoutes).toEqual(hdRoutes)
  let validationCount = 0
  expect(
    findRoutesAlongEndpointPath({
      connectionName: "connected_copper",
      hdRoutes,
      start: points[0]!,
      end: points[points.length - 1]!,
      endpointIndex: new EndpointClusterIndex(),
      canStitchBetweenTerminals: () => {
        validationCount++
        return false
      },
    }),
  ).toBeNull()
  expect(validationCount).toBe(1)

  const directCopper: HighDensityIntraNodeRoute = {
    ...hdRoutes[0]!,
    route: [points[1]!, points[4]!],
  }
  const shorterConnectedPath = selectRoutesAlongEndpointPath({
    connectionName: "connected_copper",
    hdRoutes: [...hdRoutes, directCopper].reverse(),
    start: points[0]!,
    end: points[points.length - 1]!,
    endpointIndex: new EndpointClusterIndex(),
    canStitchBetweenTerminals: () => true,
  })
  expect(shorterConnectedPath).toEqual([
    hdRoutes[0]!,
    directCopper,
    hdRoutes[4]!,
  ])

  const sharedRootSolver = new MultipleHighDensityRouteStitchSolver3({
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
    connections: [
      {
        name: "branch",
        __rootConnectionNames: ["net"],
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "start" },
          { x: 4, y: 0, layer: "top", pcb_port_id: "end" },
        ],
      },
      {
        name: "shared",
        __rootConnectionNames: ["net"],
        pointsToConnect: [
          { x: 1, y: 2, layer: "top", pcb_port_id: "sibling" },
          { x: 4, y: 0, layer: "top", pcb_port_id: "end" },
        ],
      },
      {
        name: "shortcut",
        __rootConnectionNames: ["net"],
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "start" },
          { x: 1, y: 2, layer: "top", pcb_port_id: "sibling" },
        ],
      },
    ],
    hdRoutes: [
      {
        ...hdRoutes[0]!,
        connectionName: "branch",
        rootConnectionName: "net",
        startPcbPortId: "start",
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
      },
      {
        ...hdRoutes[0]!,
        connectionName: "shared",
        rootConnectionName: "net",
        startPcbPortId: "sibling",
        endPcbPortId: "end",
        route: [
          { x: 1, y: 2, z: 0 },
          { x: 4, y: 0, z: 0 },
        ],
      },
      {
        ...hdRoutes[0]!,
        connectionName: "shared",
        rootConnectionName: "net",
        route: [
          { x: 1, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 },
        ],
      },
      {
        ...hdRoutes[0]!,
        connectionName: "shared",
        rootConnectionName: "net",
        endPcbPortId: "end",
        route: [
          { x: 2, y: 0, z: 0 },
          { x: 4, y: 0, z: 0 },
        ],
      },
      {
        ...hdRoutes[0]!,
        connectionName: "shortcut",
        rootConnectionName: "net",
        startPcbPortId: "start",
        endPcbPortId: "sibling",
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 2, z: 0 },
          { x: 1, y: 2, z: 0 },
        ],
      },
    ],
  })
  sharedRootSolver.solve()
  expect(sharedRootSolver.failed).toBeFalse()
  const branch = sharedRootSolver.mergedHdRoutes.find(
    (route) => route.connectionName === "branch",
  )!
  expect([branch.startPcbPortId, branch.endPcbPortId].sort()).toEqual([
    "end",
    "start",
  ])
  expect(branch.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
  ])
})
