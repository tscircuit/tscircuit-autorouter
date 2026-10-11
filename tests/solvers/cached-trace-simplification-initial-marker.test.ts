import {
  TraceSimplificationSolver,
  type HighDensityRoute,
  type Obstacle,
} from "@tscircuit/trace-simplification-solver"
import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CachedTraceSimplificationSolver } from "../../lib/solvers/TraceSimplificationSolver/CachedTraceSimplificationSolver"

test("initial constructor marker caches connectivity before derived initialization", (): void => {
  const connMap = new ConnectivityMap({
    net0: ["route", "pad"],
    net1: ["other"],
  })
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: 10, y: 10 },
      width: 1,
      height: 1,
      layers: ["top", "bottom"],
      connectedTo: ["other"],
    },
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      layers: ["top", "bottom"],
      connectedTo: ["pad"],
      circuitJsonMetadata: { pcb_plated_hole_id: "connected" },
    },
  ]
  const route: HighDensityRoute = {
    connectionName: "route",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0.2, y: 0, z: 0 },
      { x: 0.3, y: 0, z: 1 },
    ],
    vias: [
      { x: 0, y: 0 },
      { x: 0.2, y: 0 },
      { x: 20, y: 20 },
    ],
  }
  const params = {
    hdRoutes: [route],
    obstacles,
    connMap,
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 2,
  }
  const reference = new TraceSimplificationSolver(params)
  const connectivity = spyOn(connMap, "areIdsConnected")
  try {
    const cached = new CachedTraceSimplificationSolver(params)
    expect(cached.hdRoutes).toEqual(reference.hdRoutes)
    // One test per normalized obstacle, shared by all segments and vias.
    expect(connectivity).toHaveBeenCalledTimes(obstacles.length)
    const afterConstructor = connectivity.mock.calls.length
    expect(
      cached.markThroughObstacleSegments([structuredClone(route)]),
    ).toEqual(reference.hdRoutes)
    expect(connectivity.mock.calls.length).toBe(afterConstructor)
    obstacles[0]!.connectedTo.push("route")
    expect(cached.markThroughObstacleSegments([route])).toEqual(
      reference.markThroughObstacleSegments([route]),
    )
    expect(connectivity.mock.calls.length).toBeGreaterThan(afterConstructor)
  } finally {
    connectivity.mockRestore()
  }
})
