import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { arePipeline9NativeRoutesPhysicallyValid } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import { getPipeline9PhysicalBoardObstaclesInBounds } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalBoardObstaclesInBounds"
import type { HighDensityRoute } from "../../lib/types/high-density-types"
import type { Obstacle } from "../../lib/types/srj-types"

test("cached original-board queries retain rotated pads, circles, holes, and full-stack via obstacles", () => {
  let distantGeometryReads = 0
  const obstacles: Obstacle[] = [
    { obstacleId: "rotated", type: "rect", center: { x: 0, y: 0 }, width: 4, height: 0.2, ccwRotationDegrees: 90, layers: ["bottom"], connectedTo: [] },
    { obstacleId: "diagonal", type: "rect", center: { x: 5, y: 0 }, width: 4, height: 0.2, ccwRotationDegrees: 45, layers: ["top"], connectedTo: [] },
    { obstacleId: "circle", type: "rect", shape: "circle", center: { x: 10, y: 0 }, width: 1, height: 1, layers: ["top"], connectedTo: [] },
    { obstacleId: "hole", type: "rect", shape: "circle", center: { x: 15, y: 0 }, width: 0.2, height: 0.2, layers: ["bottom"], isNonPlatedHole: true, connectedTo: [] },
    { obstacleId: "top-pad", type: "rect", center: { x: 20, y: 0 }, width: 0.3, height: 0.3, layers: ["top"], connectedTo: [] },
    { obstacleId: "distant", type: "rect", center: { get x() { distantGeometryReads++; return 100 }, y: 100 }, width: 1, height: 1, layers: ["top"], connectedTo: [] },
  ]
  const query = (x: number, y: number, padding = 0.2): Obstacle[] =>
    getPipeline9PhysicalBoardObstaclesInBounds(obstacles, {
      minX: x - padding, minY: y - padding, maxX: x + padding, maxY: y + padding,
    })
  expect(query(0, 1.7)).toEqual([obstacles[0]!])
  const initialReads = distantGeometryReads
  expect(initialReads).toBeGreaterThan(0)
  expect(query(3.6, -1.4)).toEqual([obstacles[1]!])
  expect(query(10.5, 0)).toEqual([obstacles[2]!])
  expect(query(15, 0)).toEqual([obstacles[3]!])
  expect(query(20, 0)).toEqual([obstacles[4]!])
  expect(query(50, 50)).toEqual([])
  expect(distantGeometryReads).toBe(initialReads)
  expect(getPipeline9PhysicalBoardObstaclesInBounds([], { minX: 0, minY: 0, maxX: 1, maxY: 1 })).toEqual([])
  const common = {
    connMap: new ConnectivityMap({}), layerCount: 4, traceClearance: 0.1,
    viaHoleDiameter: 0.15, minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    viaToPadClearance: 0.1,
  }
  const wire = (x: number, y: number, z: number): HighDensityRoute => ({
    connectionName: "wire", traceThickness: 0.1, viaDiameter: 0.3, vias: [],
    route: [{ x: x - 0.05, y, z }, { x: x + 0.05, y, z }],
  })
  const via: HighDensityRoute = {
    connectionName: "via", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 20, y: 0, z: 1 }, { x: 20, y: 0, z: 3 }],
    vias: [{ x: 20, y: 0 }],
  }
  for (const [route, x, y] of [
    [wire(0, 1.7, 3), 0, 1.7], [wire(10.5, 0, 0), 10.5, 0],
    [wire(15, 0, 0), 15, 0], [via, 20, 0],
  ] as const) {
    expect(arePipeline9NativeRoutesPhysicallyValid({ ...common, routes: [route], boardObstacles: obstacles })).toBeFalse()
    expect(arePipeline9NativeRoutesPhysicallyValid({ ...common, routes: [route], boardObstacles: query(x, y) })).toBeFalse()
  }
  expect(query(0, 1.7)[0]).toBe(obstacles[0])
})
