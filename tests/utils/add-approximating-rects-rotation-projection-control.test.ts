import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

test("retain legitimate rotated-pad projection", (): void => {
  for (const rotation of [-45, 45, 135, 233]) {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      obstacles: [
        {
          type: "rect",
          layers: ["top"],
          center: { x: 0, y: 0 },
          width: 0.4,
          height: 2,
          ccwRotationDegrees: rotation,
          connectedTo: ["port"],
        },
        {
          type: "rect",
          layers: ["top"],
          center: { x: 0, y: 0.8 },
          width: 0.1,
          height: 0.1,
          connectedTo: ["port"],
        },
      ],
      connections: [
        {
          name: "net",
          pointsToConnect: [{ x: 0, y: 0.8, layer: "top", pointId: "port" }],
        },
      ],
    }
    expect(addApproximatingRectsToSrj(srj).connections).toEqual(srj.connections)
  }
  const angle = (90.005 * Math.PI) / 180
  const point = {
    x: 0.1999998 * Math.cos(angle) + 0.724999275 * Math.sin(angle),
    y: 0.1999998 * Math.sin(angle) - 0.724999275 * Math.cos(angle),
    layer: "top",
    pointId: "own",
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 1.45,
        ccwRotationDegrees: 90.005,
        connectedTo: ["own"],
      },
    ],
    connections: [{ name: "net", pointsToConnect: [point] }],
  }
  const output =
    addApproximatingRectsToSrj(srj).connections[0]!.pointsToConnect[0]!
  expect(output.x).toBe(point.x)
  expect(output.y).toBe(0.2)
  expect(point.y).toBeGreaterThan(output.y)
  expect(output.pointId).toBe("own")
  const otherLayer = {
    ...srj,
    connections: [
      { name: "net", pointsToConnect: [{ ...point, layer: "bottom" }] },
    ],
  }
  expect(addApproximatingRectsToSrj(otherLayer).connections).toEqual(
    otherLayer.connections,
  )
})
