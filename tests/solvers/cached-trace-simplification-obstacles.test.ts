import {
  TraceSimplificationSolver,
  type HighDensityRoute,
  type Obstacle,
} from "@tscircuit/trace-simplification-solver"
import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CachedTraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/CachedTraceSimplificationSolver"

test("cached simplification obstacle patterns preserve marking, metadata order, layers and input geometry", (): void => {
  const connMap = new ConnectivityMap({
    net0: ["route", "pad"],
    net1: ["root", "root-pad"],
    net2: ["other", "other-pad"],
  })
  const baseObstacle: Obstacle = {
    type: "rect",
    layers: ["top", "bottom"],
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    connectedTo: ["root-pad"],
  }
  const obstacles: Obstacle[] = [
    { ...baseObstacle, connectedTo: ["other-pad"] },
    { ...baseObstacle, layers: ["top", "top"] },
    {
      ...baseObstacle,
      __zLayers: [0, 2, 99, 2],
      circuitJsonMetadata: { pcb_plated_hole_id: "first" },
    },
    {
      ...baseObstacle,
      connectedTo: ["route"],
      circuitJsonMetadata: { pcb_plated_hole_id: "second" },
    },
    {
      ...baseObstacle,
      center: { x: 5, y: 5 },
      connectedTo: ["pad"],
      layers: ["invalid"],
      circuitJsonMetadata: { pcb_plated_hole_id: "invalid-layers" },
    },
  ]
  const route: HighDensityRoute = {
    connectionName: "route",
    rootConnectionName: "root",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
      {
        x: 5,
        y: 5,
        z: 2,
        toNextSegmentType: "through_obstacle",
        toNextSegmentCircuitJsonMetadata: { pcb_plated_hole_id: "stale" },
      },
      { x: 5, y: 5, z: 0 },
      { x: 20, y: 20, z: 0 },
    ],
    vias: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 20, y: 20 }],
  }
  const params = {
    hdRoutes: [route],
    obstacles,
    connMap,
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 3,
  }
  const originalInput = JSON.stringify(params)
  const reference = new TraceSimplificationSolver(params)
  const cached = new CachedTraceSimplificationSolver(params)
  expect(cached.hdRoutes).toEqual(reference.hdRoutes)

  const connectivity = spyOn(connMap, "areIdsConnected")
  try {
    const expected = reference.markThroughObstacleSegments([route])
    expect(cached.markThroughObstacleSegments([route])).toEqual(expected)
    expect(expected[0].route[0].toNextSegmentCircuitJsonMetadata).toEqual({
      pcb_plated_hole_id: "first",
    })
    expect(expected[0].route[2].toNextSegmentCircuitJsonMetadata).toEqual({
      pcb_plated_hole_id: "invalid-layers",
    })
    expect(expected[0].vias).toEqual([{ x: 20, y: 20 }])

    const afterWarming = connectivity.mock.calls.length
    const repeated = cached.markThroughObstacleSegments([structuredClone(route)])
    expect(repeated).toEqual(expected)
    expect(connectivity.mock.calls.length).toBe(afterWarming)

    const changedGeometry: HighDensityRoute = {
      ...route,
      route: route.route.map((point) => ({ ...point, x: point.x + 3 })),
      vias: route.vias.map((via) => ({ ...via, x: via.x + 3 })),
    }
    expect(cached.markThroughObstacleSegments([changedGeometry])).toEqual(
      reference.markThroughObstacleSegments([changedGeometry]),
    )
    const changedRoot = { ...route, rootConnectionName: "other" }
    expect(cached.markThroughObstacleSegments([changedRoot])).toEqual(
      reference.markThroughObstacleSegments([changedRoot]),
    )
    const changedConnection = { ...route, connectionName: "other", rootConnectionName: undefined }
    expect(cached.markThroughObstacleSegments([changedConnection])).toEqual(
      reference.markThroughObstacleSegments([changedConnection]),
    )

    const planarRoute: HighDensityRoute = {
      ...route,
      connectionName: "unknown-planar",
      rootConnectionName: undefined,
      route: route.route.map((point) => ({ ...point, z: 0 })),
      vias: [],
    }
    const beforePlanar = connectivity.mock.calls.length
    const markedPlanar = cached.markThroughObstacleSegments([planarRoute])
    expect(connectivity.mock.calls.length).toBe(beforePlanar)
    expect(markedPlanar).toEqual(reference.markThroughObstacleSegments([planarRoute]))
  } finally {
    connectivity.mockRestore()
  }
  expect(JSON.stringify(params)).toBe(originalInput)
})
