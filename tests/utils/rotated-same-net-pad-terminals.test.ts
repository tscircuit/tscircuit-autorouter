import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

test("rotated pads on the same net keep their own terminal coordinates", (): void => {
  const points = [0, 0.635, -0.635].map((y, index) => ({
    x: 0,
    y,
    layer: "bottom",
    pointId: `port-${index}`,
    pcb_port_id: `port-${index}`,
  }))
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: points.map((point) => ({
      type: "rect",
      center: { x: point.x, y: point.y },
      layers: ["bottom"],
      width: 0.4,
      height: 1.45,
      ccwRotationDegrees: 90,
      connectedTo: points.map((terminal) => terminal.pointId),
    })),
    connections: [{ name: "ground", pointsToConnect: points }],
  }

  const output = addApproximatingRectsToSrj(srj)

  expect(output.connections[0]!.pointsToConnect).toEqual(points)
  expect(output.obstacles).toHaveLength(3)
  expect(output.obstacles[0]!.width).toBe(1.45)
  expect(output.obstacles[0]!.height).toBe(0.4)
})
