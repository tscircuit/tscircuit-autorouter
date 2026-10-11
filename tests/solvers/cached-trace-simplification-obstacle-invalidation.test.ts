import {
  TraceSimplificationSolver,
  type HighDensityRoute,
  type Obstacle,
} from "@tscircuit/trace-simplification-solver"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CachedTraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/CachedTraceSimplificationSolver"

test("simplification obstacle patterns refresh after connectivity merges and connectedTo edits", (): void => {
  const connMap = new ConnectivityMap({
    net0: ["route", "pad"],
    net1: ["foreign-pad"],
  })
  const obstacle: Obstacle = {
    type: "rect",
    layers: ["top", "bottom"],
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    connectedTo: ["foreign-pad"],
    circuitJsonMetadata: { pcb_plated_hole_id: "first" },
  }
  const secondObstacle: Obstacle = {
    ...obstacle,
    connectedTo: ["pad"],
    circuitJsonMetadata: { pcb_plated_hole_id: "second" },
  }
  const route: HighDensityRoute = {
    connectionName: "route",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const params = {
    hdRoutes: [route],
    obstacles: [obstacle, secondObstacle],
    connMap,
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 2,
  }
  const reference = new TraceSimplificationSolver(params)
  const cached = new CachedTraceSimplificationSolver(params)
  expect(cached.markThroughObstacleSegments([route])).toEqual(
    reference.markThroughObstacleSegments([route]),
  )

  connMap.addConnections([["route", "foreign-pad"]])
  const merged = cached.markThroughObstacleSegments([route])
  expect(merged).toEqual(reference.markThroughObstacleSegments([route]))
  expect(merged[0].route[0].toNextSegmentCircuitJsonMetadata).toEqual({
    pcb_plated_hole_id: "first",
  })

  obstacle.connectedTo.splice(0, 1, "unconnected")
  const relabeled = cached.markThroughObstacleSegments([route])
  expect(relabeled).toEqual(reference.markThroughObstacleSegments([route]))
  expect(relabeled[0].route[0].toNextSegmentCircuitJsonMetadata).toEqual({
    pcb_plated_hole_id: "second",
  })

  secondObstacle.connectedTo.length = 0
  const disconnected = cached.markThroughObstacleSegments([route])
  expect(disconnected).toEqual(reference.markThroughObstacleSegments([route]))
  expect(disconnected[0].vias).toEqual(route.vias)
  expect(disconnected[0].route[0].toNextSegmentType).toBeUndefined()

  secondObstacle.connectedTo.push("route")
  const reconnected = cached.markThroughObstacleSegments([route])
  expect(reconnected).toEqual(reference.markThroughObstacleSegments([route]))
  expect(reconnected[0].vias).toEqual([])
  expect(reconnected[0].route[0].toNextSegmentType).toBe("through_obstacle")
})
