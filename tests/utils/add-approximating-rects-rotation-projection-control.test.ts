import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

test("local-frame containment handles general rotations and retains genuine approximation reprojection", () => {
  for (const rotation of [-45, 45, 135, 233]) {
    const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1,
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      obstacles: [{ obstacleId: "wrong-neighbor", type: "rect", layers: ["top"], center: { x: 0, y: 0 }, width: 0.4, height: 2, ccwRotationDegrees: rotation, connectedTo: ["port"] },
        { obstacleId: "own-pad", type: "rect", layers: ["top"], center: { x: 0, y: 0.8 }, width: 0.1, height: 0.1, connectedTo: ["port"] }],
      connections: [{ name: "net", pointsToConnect: [{ x: 0, y: 0.8, layer: "top", pointId: "port" }] }] }
    expect(addApproximatingRectsToSrj(srj).connections).toEqual(srj.connections)
  }
  // A point really inside a90.005° pad can lie just outside the converter's
  // tolerated90° approximation. Keep the existing legitimate clamp behavior.
  const angle = 90.005 * Math.PI / 180
  const localX = 0.1999998
  const localY = -0.724999275
  const point = { x: localX * Math.cos(angle) - localY * Math.sin(angle),
    y: localX * Math.sin(angle) + localY * Math.cos(angle), layer: "top", pointId: "own" }
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [{ obstacleId: "own", type: "rect", layers: ["top"], center: { x: 0, y: 0 }, width: 0.4, height: 1.45, ccwRotationDegrees: 90.005, connectedTo: ["own"] }],
    connections: [{ name: "net", pointsToConnect: [point] }] }
  const output = addApproximatingRectsToSrj(srj).connections[0]!.pointsToConnect[0]!
  expect(output.x).toBe(point.x)
  expect(output.y).toBe(0.2)
  expect(point.y).toBeGreaterThan(output.y)
  expect(output.pointId).toBe("own")
  const differentLayer = { ...srj, connections: [{ name: "net", pointsToConnect: [{ ...point, layer: "bottom" }] }] }
  expect(addApproximatingRectsToSrj(differentLayer).connections).toEqual(differentLayer.connections)
})
